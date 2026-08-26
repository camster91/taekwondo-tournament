type AttentionSeverity = 'critical' | 'warning' | 'info';

export type TournamentAttentionKind =
  | 'missing_bracket'
  | 'unchecked_soon'
  | 'schedule_conflict'
  | 'idle_ring'
  | 'ring_delay'
  | 'unresolved_incident'
  | 'stale_public_display'
  | 'division_blocked';

interface AttentionMatch {
  id: string;
  matchNumber?: number;
  status: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  ringNumber: number | null;
  scheduledTime: Date | null;
  updatedAt: Date;
}

interface AttentionDivision {
  id: string;
  name: string;
  assignments: Array<{ registrationId: string; checkedIn: boolean }>;
  bracket: { id: string; matches: AttentionMatch[] } | null;
}

interface AttentionIncident {
  id: string;
  type?: string;
  createdAt?: Date;
  severity: string;
  actionTaken: string | null;
}

export interface TournamentAttentionInput {
  tournament: { id: string; status: string; publicSlug: string | null };
  now: Date;
  displayLastSeenAt?: Date | null;
  divisions: AttentionDivision[];
  incidents: AttentionIncident[];
}

export interface TournamentAttentionAlert {
  id: string;
  kind: TournamentAttentionKind;
  severity: AttentionSeverity;
  title: string;
  summary: string;
  recommendation: string;
  href: string;
  detectedAt: string;
  affectedLabels: string[];
  affected: {
    tournamentId: string;
    divisionIds?: string[];
    matchIds?: string[];
    registrationIds?: string[];
    incidentIds?: string[];
    ringNumbers?: number[];
  };
}

const SOON_MS = 30 * 60_000;
const CONFLICT_MS = 5 * 60_000;
const DISPLAY_STALE_MS = 30_000;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function buildTournamentAttention(input: TournamentAttentionInput): TournamentAttentionAlert[] {
  const { tournament, now, divisions, incidents } = input;
  if (tournament.status === 'completed') return [];

  const detectedAt = now.toISOString();
  const alerts: TournamentAttentionAlert[] = [];
  const base = { tournamentId: tournament.id };
  const href = (suffix: string) => `/tournaments/${tournament.id}/${suffix}`;
  const add = (alert: Omit<TournamentAttentionAlert, 'detectedAt'>) => alerts.push({ ...alert, detectedAt });

  const missing = divisions.filter((division) => division.assignments.length >= 2 && !division.bracket);
  if (missing.length) {
    add({
      id: `missing_bracket:${missing.map((division) => division.id).sort().join(',')}`,
      kind: 'missing_bracket', severity: 'critical', title: 'Divisions need brackets',
      summary: `${missing.length} division${missing.length === 1 ? '' : 's'} cannot start because no bracket has been generated.`,
      recommendation: 'Generate and review the missing brackets before sending athletes to a ring.',
      href: href('divisions'), affected: { ...base, divisionIds: missing.map((division) => division.id) },
      affectedLabels: missing.map((division) => division.name),
    });
  }

  const matchRows = divisions.flatMap((division) =>
    (division.bracket?.matches ?? []).map((match) => ({ division, match })),
  );
  const checkIn = new Map(divisions.flatMap((division) =>
    division.assignments.map((assignment) => [assignment.registrationId, assignment.checkedIn] as const),
  ));
  const soonRows = matchRows.filter(({ match }) =>
    Boolean(match.scheduledTime)
    && match.scheduledTime!.getTime() >= now.getTime() - CONFLICT_MS
    && match.scheduledTime!.getTime() <= now.getTime() + SOON_MS
    && ['pending', 'ready', 'in_progress'].includes(match.status),
  );
  const uncheckedIds = unique(soonRows.flatMap(({ match }) =>
    [match.competitor1Id, match.competitor2Id].filter((id): id is string => Boolean(id) && checkIn.get(id!) === false),
  ));
  if (uncheckedIds.length) {
    const affectedRows = soonRows.filter(({ match }) =>
      uncheckedIds.includes(match.competitor1Id ?? '') || uncheckedIds.includes(match.competitor2Id ?? ''),
    );
    add({
      id: `unchecked_soon:${uncheckedIds.sort().join(',')}`,
      kind: 'unchecked_soon', severity: 'critical', title: 'Athletes missing check-in',
      summary: `${uncheckedIds.length} athlete${uncheckedIds.length === 1 ? '' : 's'} in soon-starting matches are not checked in.`,
      recommendation: 'Confirm arrival and weigh-in before calling these matches.',
      href: `/checkin/${tournament.id}`,
      affected: { ...base, registrationIds: uncheckedIds, matchIds: affectedRows.map(({ match }) => match.id) },
      affectedLabels: affectedRows.map(({ division, match }) => `${division.name}, match ${match.matchNumber ?? match.id.slice(0, 8)}${match.ringNumber ? `, Ring ${match.ringNumber}` : ''}`),
    });
  }

  const conflictingIds = new Set<string>();
  for (let i = 0; i < soonRows.length; i += 1) {
    for (let j = i + 1; j < soonRows.length; j += 1) {
      const a = soonRows[i]!.match;
      const b = soonRows[j]!.match;
      const sameRing = a.ringNumber !== null && a.ringNumber === b.ringNumber;
      const aPeople = [a.competitor1Id, a.competitor2Id].filter(Boolean);
      const sharedAthlete = aPeople.some((id) => id === b.competitor1Id || id === b.competitor2Id);
      if (Math.abs(a.scheduledTime!.getTime() - b.scheduledTime!.getTime()) < CONFLICT_MS && (sameRing || sharedAthlete)) {
        conflictingIds.add(a.id);
        conflictingIds.add(b.id);
      }
    }
  }
  if (conflictingIds.size) {
    const conflicts = matchRows.filter(({ match }) => conflictingIds.has(match.id));
    add({
      id: `schedule_conflict:${[...conflictingIds].sort().join(',')}`,
      kind: 'schedule_conflict', severity: 'warning', title: 'Schedule conflict detected',
      summary: `${conflictingIds.size} matches overlap on a ring or share an athlete within five minutes.`,
      recommendation: 'Adjust the affected match times or ring assignments before calling competitors.',
      href: href('schedule'),
      affected: { ...base, matchIds: [...conflictingIds], ringNumbers: unique(conflicts.flatMap(({ match }) => match.ringNumber === null ? [] : [match.ringNumber])) },
      affectedLabels: conflicts.map(({ division, match }) => `${division.name}, match ${match.matchNumber ?? match.id.slice(0, 8)}${match.ringNumber ? `, Ring ${match.ringNumber}` : ''}`),
    });
  }

  const readyByRing = new Map<number, string[]>();
  const activeRings = new Set(matchRows.filter(({ match }) => match.status === 'in_progress' && match.ringNumber !== null).map(({ match }) => match.ringNumber!));
  for (const { match } of matchRows) {
    const due = !match.scheduledTime || match.scheduledTime.getTime() <= now.getTime();
    if (!['active', 'in_progress'].includes(tournament.status) || match.status !== 'ready' || !due
      || match.ringNumber === null || activeRings.has(match.ringNumber)) continue;
    readyByRing.set(match.ringNumber, [...(readyByRing.get(match.ringNumber) ?? []), match.id]);
  }
  if (readyByRing.size) {
    const rings = [...readyByRing.keys()].sort((a, b) => a - b);
    add({
      id: `idle_ring:${rings.join(',')}`,
      kind: 'idle_ring', severity: 'warning', title: 'Ready matches are waiting on idle rings',
      summary: `${rings.length} ring${rings.length === 1 ? '' : 's'} have ready matches but no match in progress.`,
      recommendation: 'Confirm ring staff are ready, then call the next assigned match.',
      href: href('schedule'),
      affected: { ...base, ringNumbers: rings, matchIds: rings.flatMap((ring) => readyByRing.get(ring) ?? []) },
      affectedLabels: rings.map((ring) => `Ring ${ring}`),
    });
  }

  const delayed = matchRows.filter(({ match }) =>
    match.status === 'in_progress' && now.getTime() - match.updatedAt.getTime() > 10 * 60_000,
  );
  if (delayed.length) {
    add({
      id: `ring_delay:${delayed.map(({ match }) => match.id).sort().join(',')}`,
      kind: 'ring_delay', severity: 'warning', title: 'Matches may be running behind',
      summary: `${delayed.length} match${delayed.length === 1 ? ' has' : 'es have'} been in progress for more than ten minutes.`,
      recommendation: 'Check with the ring team and update the schedule if the delay will affect upcoming matches.',
      href: href('director'),
      affected: {
        ...base,
        matchIds: delayed.map(({ match }) => match.id),
        ringNumbers: unique(delayed.flatMap(({ match }) => match.ringNumber === null ? [] : [match.ringNumber])),
      },
      affectedLabels: delayed.map(({ division, match }) => `${division.name}, match ${match.matchNumber ?? match.id.slice(0, 8)}${match.ringNumber ? `, Ring ${match.ringNumber}` : ''}`),
    });
  }

  const unresolved = incidents.filter((incident) => !incident.actionTaken?.trim());
  if (unresolved.length) {
    const critical = unresolved.some((incident) => ['serious', 'critical', 'medical'].includes(incident.severity.toLowerCase()));
    add({
      id: `unresolved_incident:${unresolved.map((incident) => incident.id).sort().join(',')}`,
      kind: 'unresolved_incident', severity: critical ? 'critical' : 'warning', title: 'Incidents need director action',
      summary: `${unresolved.length} incident${unresolved.length === 1 ? '' : 's'} have no recorded action.`,
      recommendation: 'Review each incident, record the response, and escalate medical or safety concerns immediately.',
      href: `${href('director')}#incidents`, affected: { ...base, incidentIds: unresolved.map((incident) => incident.id) },
      affectedLabels: unresolved.map((incident) => `${incident.type ? incident.type.replace(/_/g, ' ') : 'Incident'}${incident.createdAt ? ` at ${incident.createdAt.toISOString()}` : ''}`),
    });
  }

  if (['active', 'in_progress'].includes(tournament.status) && tournament.publicSlug && input.displayLastSeenAt
    && now.getTime() - input.displayLastSeenAt.getTime() > DISPLAY_STALE_MS) {
    add({
      id: 'stale_public_display', kind: 'stale_public_display', severity: 'warning', title: 'Public display is not reporting',
      summary: 'A previously connected public display is no longer reporting current data.',
      recommendation: 'Open or refresh the venue display and confirm it is showing current match data.',
      href: `/display/${tournament.id}`, affected: base,
      affectedLabels: ['Venue display'],
    });
  }

  const blocked = divisions.filter((division) => {
    const matches = division.bracket?.matches ?? [];
    return division.assignments.length >= 2 && matches.length > 0
      && matches.every((match) => match.status === 'pending')
      && matches.every((match) => !match.competitor1Id || !match.competitor2Id);
  });
  if (blocked.length) {
    add({
      id: `division_blocked:${blocked.map((division) => division.id).sort().join(',')}`,
      kind: 'division_blocked', severity: 'critical', title: 'Divisions are blocked from starting',
      summary: `${blocked.length} bracket${blocked.length === 1 ? '' : 's'} have no startable match.`,
      recommendation: 'Review seeds and bracket progression so the first match has two assigned competitors.',
      href: href('divisions'), affected: { ...base, divisionIds: blocked.map((division) => division.id) },
      affectedLabels: blocked.map((division) => division.name),
    });
  }

  const severityOrder: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id));
}

export async function loadTournamentAttention(
  prisma: Pick<PrismaClient, 'tournament'>,
  tournamentId: string,
  now = new Date(),
): Promise<TournamentAttentionAlert[] | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId, deletedAt: null },
    select: {
      id: true,
      status: true,
      publicSlug: true,
      publicDisplayHeartbeat: { select: { lastSeenAt: true } },
      divisions: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          assignments: {
            select: { registration: { select: { id: true, checkedIn: true } } },
          },
          bracket: {
            select: {
              id: true,
              matches: {
                select: {
                  id: true,
                  matchNumber: true,
                  status: true,
                  competitor1Id: true,
                  competitor2Id: true,
                  ringNumber: true,
                  scheduledTime: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      },
      incidents: {
        where: { deletedAt: null },
        select: { id: true, type: true, severity: true, actionTaken: true, createdAt: true },
      },
    },
  });
  if (!tournament) return null;

  return buildTournamentAttention({
    tournament: { id: tournament.id, status: tournament.status, publicSlug: tournament.publicSlug },
    now,
    displayLastSeenAt: tournament.publicDisplayHeartbeat?.lastSeenAt,
    divisions: tournament.divisions.map((division) => ({
      id: division.id,
      name: division.name,
      assignments: division.assignments.map(({ registration }) => ({
        registrationId: registration.id,
        checkedIn: registration.checkedIn,
      })),
      bracket: division.bracket,
    })),
    incidents: tournament.incidents,
  });
}
import type { PrismaClient } from '@prisma/client';

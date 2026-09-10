export type OperationalQueryIntent =
  | { kind: 'blocked_divisions' }
  | { kind: 'next_competitors'; windowMinutes: number }
  | { kind: 'ring_delay'; ring: number }
  | { kind: 'schools_need_checkin' }
  | { kind: 'unsupported' };

export interface OperationalQueryAnswer {
  answer: string;
  generatedAt: string;
  evidence: Array<{ label: string; href: string; observedAt: string }>;
}

const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * This intentionally recognizes a small, read-only vocabulary. It is not an
 * LLM prompt or a command parser: anything outside these questions is refused
 * so an operational query can never be mistaken for a mutation request.
 */
export function parseOperationalQuery(question: string): OperationalQueryIntent {
  const value = normalized(question);
  if (!value) return { kind: 'unsupported' };
  if (/\bdivisions?\b/.test(value) && /\bblocked?\b/.test(value)) return { kind: 'blocked_divisions' };
  if (/\bschools?\b/.test(value) && /\bcheck\s*-?in\b/.test(value)) return { kind: 'schools_need_checkin' };

  const next = value.match(/\bnext\s+(\d{1,3})\s+minutes?\b/);
  if (/\b(?:who|which athletes?|competitors?)\b/.test(value) && next) {
    const windowMinutes = Number(next[1]);
    if (Number.isInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 240) return { kind: 'next_competitors', windowMinutes };
  }

  const ring = value.match(/\bring\s+(\d{1,2})\b/);
  if (ring && /\b(?:late|behind|delay(?:ed)?)\b/.test(value)) {
    // SH-4: Match.ring is a free-form string. Keep the parsed user
    // input as a string so the comparison against ringNumbers (also
    // strings) works without a coercion.
    const ringLabel = ring[1];
    if (ringLabel.length >= 1) return { kind: 'ring_delay', ring: ringLabel };
  }
  return { kind: 'unsupported' };
}

export function buildUnsupportedOperationalAnswer(now = new Date()): OperationalQueryAnswer {
  return {
    answer: 'I can answer: which divisions are blocked, who competes in the next number of minutes, why a ring is late, or which schools need check-in.',
    generatedAt: now.toISOString(),
    evidence: [],
  };
}

export function buildRingDelayOperationalAnswer(
  input: { tournamentId: string; ring: number; delayedMatches: Array<{ label: string; observedAt: string }> },
  now = new Date(),
): OperationalQueryAnswer {
  const count = input.delayedMatches.length;
  return {
    answer: count
      ? `Ring ${input.ring} may be late because ${count} match${count === 1 ? ' has' : 'es have'} remained in progress for more than ten minutes.`
      : `No current server-recorded delay was found for Ring ${input.ring}.`,
    generatedAt: now.toISOString(),
    evidence: input.delayedMatches.map((match) => ({
      label: match.label,
      href: `/tournaments/${input.tournamentId}/director`,
      observedAt: match.observedAt,
    })),
  };
}

export async function answerOperationalQuery(
  prisma: PrismaClient,
  tournamentId: string,
  question: string,
  now = new Date(),
): Promise<OperationalQueryAnswer | null> {
  const intent = parseOperationalQuery(question);
  if (intent.kind === 'unsupported') return buildUnsupportedOperationalAnswer(now);
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId, deletedAt: null }, select: { id: true } });
  if (!tournament) return null;

  if (intent.kind === 'blocked_divisions' || intent.kind === 'ring_delay') {
    const alerts = await loadTournamentAttention(prisma, tournament.id, now) ?? [];
    const relevant = intent.kind === 'blocked_divisions'
      ? alerts.filter((alert) => alert.kind === 'division_blocked' || alert.kind === 'missing_bracket')
      : alerts.filter((alert) => alert.kind === 'ring_delay' && alert.affected.rings?.includes(intent.ring));
    if (intent.kind === 'ring_delay') {
      return buildRingDelayOperationalAnswer({
        tournamentId,
        ring: intent.ring,
        delayedMatches: relevant.flatMap((alert) => alert.affectedLabels.map((label) => ({ label, observedAt: alert.detectedAt }))),
      }, now);
    }
    return {
      answer: relevant.length
        ? `${relevant.reduce((count, alert) => count + alert.affectedLabels.length, 0)} division${relevant.reduce((count, alert) => count + alert.affectedLabels.length, 0) === 1 ? ' is' : 's are'} currently blocked from starting.`
        : 'No server-recorded divisions are currently blocked from starting.',
      generatedAt: now.toISOString(),
      evidence: relevant.flatMap((alert) => alert.affectedLabels.map((label) => ({ label, href: alert.href, observedAt: alert.detectedAt }))),
    };
  }

  if (intent.kind === 'next_competitors') {
    const matches = await prisma.match.findMany({
      // SH-4: schema renamed `scheduledTime` to `scheduledAt` and
      // `ringNumber` (Int) to `ring` (String). The label still reads
      // "Ring N" — we keep that string in the LLM answer for
      // backward compatibility, but read the new columns.
      where: { status: { in: ['pending', 'ready', 'in_progress'] }, scheduledAt: { gte: now, lte: new Date(now.getTime() + intent.windowMinutes * 60_000) }, bracket: { division: { tournamentId, deletedAt: null } } },
      orderBy: { scheduledAt: 'asc' }, take: 25,
      select: { scheduledAt: true, ring: true, matchNumber: true, bracket: { select: { division: { select: { name: true } } } }, competitor1: { select: { competitor: { select: { firstName: true, lastName: true } } } }, competitor2: { select: { competitor: { select: { firstName: true, lastName: true } } } } },
    });
    return { answer: matches.length ? `${matches.length} scheduled match${matches.length === 1 ? ' is' : 'es are'} in the next ${intent.windowMinutes} minutes.` : `No matches are scheduled in the next ${intent.windowMinutes} minutes.`, generatedAt: now.toISOString(), evidence: matches.map((match) => ({ label: `${match.bracket.division.name}, match ${match.matchNumber}${match.ring ? `, Ring ${match.ring}` : ''}`, href: `/tournaments/${tournamentId}/schedule`, observedAt: match.scheduledAt!.toISOString() })) };
  }

  const registrations = await prisma.registration.findMany({ where: { tournamentId, checkedIn: false }, select: { competitor: { select: { schoolDojang: true } } } });
  const schools = new Map<string, number>();
  for (const { competitor } of registrations) { const school = competitor.schoolDojang?.trim() || 'School not recorded'; schools.set(school, (schools.get(school) ?? 0) + 1); }
  return { answer: schools.size ? `${schools.size} school${schools.size === 1 ? ' has' : 's have'} athletes still needing check-in.` : 'All registered athletes are checked in.', generatedAt: now.toISOString(), evidence: [...schools].sort(([a], [b]) => a.localeCompare(b)).map(([label]) => ({ label, href: `/checkin/${tournamentId}`, observedAt: now.toISOString() })) };
}
import type { PrismaClient } from '@prisma/client';
import { loadTournamentAttention } from './tournament-attention.js';

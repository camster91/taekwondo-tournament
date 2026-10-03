// Bulk "Add competitors" from the tournament page. Applies the same
// capacity and waiting-list rules as public registration and the
// spreadsheet import: free spots are filled first, the rest go to the
// waiting list when it is on, or are skipped with a reason when the
// tournament is full without one. A director can deliberately add
// everyone past capacity (`overCapacity`).
//
// Planning is pure (`planBulkRegistration`); `applyBulkRegistration`
// re-reads capacity and writes inside one transaction holding the
// tournament row lock, so concurrent adds cannot overfill.
import type { PrismaClient } from '@prisma/client';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { CAPACITY_HOLDING_STATUSES, decideRegistrationSlot, lockTournamentForCapacity } from './waitlist.js';

export const TOURNAMENT_FULL_SKIP_REASON = 'The tournament is full and has no waiting list';

const BULK_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export interface BulkCapacityState {
  maxCapacity: number | null;
  waitlistEnabled: boolean;
  /** Registrations currently holding a spot (active or promoted). */
  activeCount: number;
  maxWaitlistPosition: number | null;
}

export type BulkPlanEntry =
  | { kind: 'update'; competitorId: string; registrationId: string }
  | { kind: 'create'; competitorId: string; waitlistStatus: 'active' | 'waitlisted'; waitlistPosition: number | null };

export interface BulkRegistrationPlan {
  entries: BulkPlanEntry[];
  skipped: Array<{ competitorId: string; reason: string }>;
  /** New registrations that hold a spot (including over-capacity ones). */
  added: number;
  waitlisted: number;
  /** Existing registrations whose events were updated (no capacity change). */
  updated: number;
  /** New registrations added past capacity because of `overCapacity`. */
  addedOverCapacity: number;
}

/**
 * Decide, in request order, what happens to each competitor. Competitors
 * already registered here (any status) only get their events updated, as
 * before; they never take or free a spot.
 */
export function planBulkRegistration(input: {
  competitorIds: string[];
  /** competitorId -> registrationId for registrations that already exist. */
  existing: Map<string, string>;
  capacity: BulkCapacityState;
  overCapacity: boolean;
}): BulkRegistrationPlan {
  const { existing, capacity, overCapacity } = input;
  let activeCount = capacity.activeCount;
  let lastWaitlistPosition = capacity.maxWaitlistPosition;
  const plan: BulkRegistrationPlan = { entries: [], skipped: [], added: 0, waitlisted: 0, updated: 0, addedOverCapacity: 0 };

  for (const competitorId of new Set(input.competitorIds)) {
    const registrationId = existing.get(competitorId);
    if (registrationId) {
      plan.entries.push({ kind: 'update', competitorId, registrationId });
      plan.updated++;
      continue;
    }

    const decision = decideRegistrationSlot({
      maxCapacity: capacity.maxCapacity,
      waitlistEnabled: capacity.waitlistEnabled,
      activeCount,
      maxWaitlistPosition: lastWaitlistPosition,
    });
    if (decision.kind !== 'active' && overCapacity) {
      plan.addedOverCapacity++;
    } else if (decision.kind === 'full') {
      plan.skipped.push({ competitorId, reason: TOURNAMENT_FULL_SKIP_REASON });
      continue;
    } else if (decision.kind === 'waitlisted') {
      lastWaitlistPosition = decision.position;
      plan.waitlisted++;
      plan.entries.push({ kind: 'create', competitorId, waitlistStatus: 'waitlisted', waitlistPosition: decision.position });
      continue;
    }
    activeCount++;
    plan.added++;
    plan.entries.push({ kind: 'create', competitorId, waitlistStatus: 'active', waitlistPosition: null });
  }
  return plan;
}

export class BulkRegistrationNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super('Tournament not found');
    this.name = 'BulkRegistrationNotFoundError';
  }
}

export interface BulkRegistrationResult {
  added: number;
  waitlisted: number;
  updated: number;
  addedOverCapacity: number;
  maxCapacity: number | null;
  skipped: Array<{ competitorId: string; name: string; reason: string }>;
}

/**
 * Plan and write a bulk add in one transaction under the tournament row
 * lock (the same lock public registration and the import take).
 */
export async function applyBulkRegistration(
  prisma: PrismaClient,
  input: {
    tournament: { id: string; date: Date };
    /** Competitors to add, in the order the director picked them. */
    competitors: Array<{ id: string; firstName: string; lastName: string; dateOfBirth: Date; weightLbs: number | null }>;
    patterns: boolean;
    sparring: boolean;
    overCapacity: boolean;
  },
): Promise<BulkRegistrationResult> {
  const { tournament, competitors, patterns, sparring, overCapacity } = input;
  return prisma.$transaction(async (tx) => {
    const locked = await lockTournamentForCapacity(tx, tournament.id);
    if (!locked) throw new BulkRegistrationNotFoundError();
    const limited = !!locked.maxCapacity && locked.maxCapacity > 0;

    const competitorIds = competitors.map((c) => c.id);
    const existing = await tx.registration.findMany({
      where: { tournamentId: tournament.id, competitorId: { in: competitorIds } },
      select: { id: true, competitorId: true },
    });
    const activeCount = limited
      ? await tx.registration.count({
          where: { tournamentId: tournament.id, waitlistStatus: { in: [...CAPACITY_HOLDING_STATUSES] } },
        })
      : 0;
    const lastWaitlisted = limited && locked.waitlistEnabled
      ? await tx.registration.findFirst({
          where: { tournamentId: tournament.id, waitlistStatus: 'waitlisted' },
          orderBy: { waitlistPosition: 'desc' },
          select: { waitlistPosition: true },
        })
      : null;

    const plan = planBulkRegistration({
      competitorIds,
      existing: new Map(existing.map((r) => [r.competitorId, r.id])),
      capacity: {
        maxCapacity: locked.maxCapacity,
        waitlistEnabled: locked.waitlistEnabled,
        activeCount,
        maxWaitlistPosition: lastWaitlisted?.waitlistPosition ?? null,
      },
      overCapacity,
    });

    const byId = new Map(competitors.map((c) => [c.id, c]));
    const creates = plan.entries.filter((e) => e.kind === 'create');
    if (creates.length) {
      await tx.registration.createMany({
        data: creates.map((entry) => {
          const competitor = byId.get(entry.competitorId)!;
          return {
            tournamentId: tournament.id,
            competitorId: competitor.id,
            patterns,
            sparring,
            weightAtRegistration: competitor.weightLbs,
            ageAtTournament: calculateAge(competitor.dateOfBirth, tournament.date),
            waitlistStatus: entry.waitlistStatus,
            waitlistPosition: entry.waitlistPosition,
          };
        }),
      });
    }
    for (const entry of plan.entries) {
      if (entry.kind !== 'update') continue;
      const competitor = byId.get(entry.competitorId)!;
      await tx.registration.update({
        where: { id: entry.registrationId },
        data: { patterns, sparring, ageAtTournament: calculateAge(competitor.dateOfBirth, tournament.date) },
      });
    }

    return {
      added: plan.added,
      waitlisted: plan.waitlisted,
      updated: plan.updated,
      addedOverCapacity: plan.addedOverCapacity,
      maxCapacity: limited ? locked.maxCapacity : null,
      skipped: plan.skipped.map((s) => {
        const c = byId.get(s.competitorId)!;
        return { competitorId: s.competitorId, name: `${c.firstName} ${c.lastName}`, reason: s.reason };
      }),
    };
  }, BULK_TRANSACTION_OPTIONS);
}

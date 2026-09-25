import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Registration statuses that occupy a capacity slot. */
export const CAPACITY_HOLDING_STATUSES = ['active', 'promoted'] as const;

/**
 * Thrown when a tournament has a hard capacity limit, is full, and has no
 * waitlist. Routes translate this into a 409.
 */
export class TournamentFullError extends Error {
  readonly status = 409;
  readonly code = 'TOURNAMENT_FULL';
  constructor(message = 'This tournament is full and is not accepting more registrations.') {
    super(message);
    this.name = 'TournamentFullError';
  }
}

export type SlotDecision =
  | { kind: 'active' }
  | { kind: 'waitlisted'; position: number }
  | { kind: 'full' };

/**
 * Pure capacity decision. `maxCapacity` null/0 means unlimited. When the
 * tournament is at capacity the registration is waitlisted if the waitlist is
 * enabled, otherwise it is rejected (`full`) — a capacity limit without a
 * waitlist is still a limit.
 */
export function decideRegistrationSlot(input: {
  maxCapacity: number | null;
  waitlistEnabled: boolean;
  activeCount: number;
  maxWaitlistPosition: number | null;
}): SlotDecision {
  const { maxCapacity, waitlistEnabled, activeCount, maxWaitlistPosition } = input;
  if (!maxCapacity || maxCapacity <= 0) return { kind: 'active' };
  if (activeCount < maxCapacity) return { kind: 'active' };
  if (!waitlistEnabled) return { kind: 'full' };
  return { kind: 'waitlisted', position: (maxWaitlistPosition ?? 0) + 1 };
}

async function countCapacityHolders(db: Db, tournamentId: string): Promise<number> {
  return db.registration.count({
    where: { tournamentId, waitlistStatus: { in: [...CAPACITY_HOLDING_STATUSES] } },
  });
}

async function maxWaitlistPosition(db: Db, tournamentId: string): Promise<number | null> {
  const row = await db.registration.findFirst({
    where: { tournamentId, waitlistStatus: 'waitlisted' },
    orderBy: { waitlistPosition: 'desc' },
    select: { waitlistPosition: true },
  });
  return row?.waitlistPosition ?? null;
}

/**
 * Advisory (unlocked) capacity check. Useful for display; registration
 * writes must use {@link reserveRegistrationSlot} inside a transaction so
 * concurrent submissions cannot overbook.
 */
export async function checkWaitlistStatus(
  prisma: Db,
  tournamentId: string,
): Promise<{ shouldWaitlist: boolean; position: number | null; isFull: boolean }> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      maxCapacity: true,
      waitlistEnabled: true,
    },
  });

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  if (!tournament.maxCapacity) {
    return { shouldWaitlist: false, position: null, isFull: false };
  }

  const activeCount = await countCapacityHolders(prisma, tournamentId);
  const decision = decideRegistrationSlot({
    maxCapacity: tournament.maxCapacity,
    waitlistEnabled: tournament.waitlistEnabled,
    activeCount,
    maxWaitlistPosition: activeCount >= tournament.maxCapacity && tournament.waitlistEnabled
      ? await maxWaitlistPosition(prisma, tournamentId)
      : null,
  });

  if (decision.kind === 'waitlisted') {
    return { shouldWaitlist: true, position: decision.position, isFull: true };
  }
  return { shouldWaitlist: false, position: null, isFull: decision.kind === 'full' };
}

/**
 * Lock the tournament row for the remainder of the transaction. Every
 * capacity-sensitive write (register, withdraw-promotion) takes this lock
 * first, so count-then-insert sequences are serialized per tournament.
 */
export async function lockTournamentForCapacity(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<{ id: string; maxCapacity: number | null; waitlistEnabled: boolean } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; maxCapacity: number | null; waitlistEnabled: boolean }>>`
    SELECT "id", "maxCapacity", "waitlistEnabled"
    FROM "Tournament"
    WHERE "id" = ${tournamentId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Decide the waitlist status for a new registration. MUST be called inside a
 * transaction after {@link lockTournamentForCapacity}; the caller inserts the
 * registration in the same transaction.
 *
 * @throws TournamentFullError when at capacity and the waitlist is disabled.
 */
export async function reserveRegistrationSlot(
  tx: Prisma.TransactionClient,
  tournament: { id: string; maxCapacity: number | null; waitlistEnabled: boolean },
): Promise<{ waitlistStatus: 'active' | 'waitlisted'; waitlistPosition: number | null }> {
  if (!tournament.maxCapacity || tournament.maxCapacity <= 0) {
    return { waitlistStatus: 'active', waitlistPosition: null };
  }
  const activeCount = await countCapacityHolders(tx, tournament.id);
  const atCapacity = activeCount >= tournament.maxCapacity;
  const decision = decideRegistrationSlot({
    maxCapacity: tournament.maxCapacity,
    waitlistEnabled: tournament.waitlistEnabled,
    activeCount,
    maxWaitlistPosition: atCapacity && tournament.waitlistEnabled
      ? await maxWaitlistPosition(tx, tournament.id)
      : null,
  });
  if (decision.kind === 'full') throw new TournamentFullError();
  if (decision.kind === 'waitlisted') {
    return { waitlistStatus: 'waitlisted', waitlistPosition: decision.position };
  }
  return { waitlistStatus: 'active', waitlistPosition: null };
}

/**
 * Renumber waitlisted registrations to a dense 1..N sequence preserving
 * their current order. Runs inside the caller's transaction.
 */
export async function renumberWaitlist(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<void> {
  const waitlisted = await tx.registration.findMany({
    where: { tournamentId, waitlistStatus: 'waitlisted' },
    orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, waitlistPosition: true },
  });
  for (let i = 0; i < waitlisted.length; i++) {
    const position = i + 1;
    if (waitlisted[i].waitlistPosition !== position) {
      await tx.registration.update({
        where: { id: waitlisted[i].id },
        data: { waitlistPosition: position },
      });
    }
  }
}

/**
 * Promote the lowest-positioned waitlisted registration if a capacity slot is
 * free, then renumber the remaining waitlist. Runs in its own transaction
 * holding the tournament row lock so it cannot race new registrations.
 *
 * Returns the promoted registration id, or null when nothing was promoted
 * (no waitlist, or still at capacity).
 */
export async function promoteNextWaitlisted(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ promotedRegistrationId: string | null }> {
  return prisma.$transaction(async (tx) => {
    const tournament = await lockTournamentForCapacity(tx, tournamentId);
    if (!tournament) return { promotedRegistrationId: null };

    let promotedRegistrationId: string | null = null;
    const activeCount = await countCapacityHolders(tx, tournamentId);
    const hasFreeSlot = !tournament.maxCapacity || activeCount < tournament.maxCapacity;

    if (hasFreeSlot) {
      const next = await tx.registration.findFirst({
        where: { tournamentId, waitlistStatus: 'waitlisted' },
        orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      if (next) {
        await tx.registration.update({
          where: { id: next.id },
          data: {
            waitlistStatus: 'promoted',
            waitlistPosition: null,
            waitlistPromotedAt: new Date(),
          },
        });
        promotedRegistrationId = next.id;
      }
    }

    await renumberWaitlist(tx, tournamentId);
    return { promotedRegistrationId };
  });
}

/**
 * Get capacity status for a tournament (for display in organizer UI and public pages).
 */
export async function getTournamentCapacityStatus(
  prisma: PrismaClient,
  tournamentId: string,
) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      maxCapacity: true,
      waitlistEnabled: true,
    },
  });

  if (!tournament) {
    return null;
  }

  const [activeCount, waitlistCount] = await Promise.all([
    prisma.registration.count({
      where: {
        tournamentId,
        waitlistStatus: { in: ['active', 'promoted'] },
      },
    }),
    prisma.registration.count({
      where: {
        tournamentId,
        waitlistStatus: 'waitlisted',
      },
    }),
  ]);

  const hasCapacityLimit = tournament.maxCapacity != null && tournament.maxCapacity > 0;
  const spotsRemaining = hasCapacityLimit && tournament.maxCapacity != null
    ? Math.max(0, tournament.maxCapacity - activeCount)
    : null;
  const isFull = hasCapacityLimit && spotsRemaining === 0;

  return {
    maxCapacity: tournament.maxCapacity,
    waitlistEnabled: tournament.waitlistEnabled,
    activeCount,
    waitlistCount,
    spotsRemaining,
    isFull,
  };
}

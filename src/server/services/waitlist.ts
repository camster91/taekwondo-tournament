import type { PrismaClient } from '@prisma/client';

/**
 * Check if a new registration should be waitlisted based on tournament capacity.
 * Returns shouldWaitlist=true if at capacity, plus the next waitlist position.
 */
export async function checkWaitlistStatus(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ shouldWaitlist: boolean; position: number | null }> {
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

  // If no capacity limit or waitlist disabled, always active
  if (!tournament.maxCapacity || !tournament.waitlistEnabled) {
    return { shouldWaitlist: false, position: null };
  }

  // Count active + promoted registrations (exclude withdrawn/waitlisted)
  const activeCount = await prisma.registration.count({
    where: {
      tournamentId,
      waitlistStatus: { in: ['active', 'promoted'] },
    },
  });

  // If under capacity, register as active
  if (activeCount < tournament.maxCapacity) {
    return { shouldWaitlist: false, position: null };
  }

  // At or over capacity: calculate next waitlist position
  const maxPosition = await prisma.registration.findFirst({
    where: {
      tournamentId,
      waitlistStatus: 'waitlisted',
    },
    orderBy: { waitlistPosition: 'desc' },
    select: { waitlistPosition: true },
  });

  const nextPosition = (maxPosition?.waitlistPosition ?? 0) + 1;

  return { shouldWaitlist: true, position: nextPosition };
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

/**
 * Promote the next waitlisted registration into a freed slot, if any.
 *
 * Called after a registration is withdrawn or cancelled so the freed
 * capacity is offered to the front of the queue. Promotion is by
 * ascending `waitlistPosition` (first come, first served), matching the
 * ordering used by checkWaitlistStatus.
 *
 * No-ops when the tournament has no capacity limit, waitlist disabled,
 * or still has room (nothing to promote).
 *
 * @returns The promoted registration id, or null when nothing was promoted.
 */
export async function promoteNextWaitlisted(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ promotedRegistrationId: string | null }> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { maxCapacity: true, waitlistEnabled: true },
  });

  if (!tournament?.maxCapacity || !tournament.waitlistEnabled) {
    return { promotedRegistrationId: null };
  }

  // Only promote when there is actually room. Active + promoted both
  // occupy capacity.
  const activeCount = await prisma.registration.count({
    where: {
      tournamentId,
      waitlistStatus: { in: ['active', 'promoted'] },
    },
  });

  if (activeCount >= tournament.maxCapacity) {
    return { promotedRegistrationId: null };
  }

  const next = await prisma.registration.findFirst({
    where: { tournamentId, waitlistStatus: 'waitlisted' },
    orderBy: { waitlistPosition: 'asc' },
    select: { id: true },
  });

  if (!next) {
    return { promotedRegistrationId: null };
  }

  await prisma.registration.update({
    where: { id: next.id },
    data: {
      waitlistStatus: 'promoted',
      waitlistPromotedAt: new Date(),
      waitlistPosition: null,
    },
  });

  return { promotedRegistrationId: next.id };
}

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
 * Promote the first waitlisted registration if a spot is open, then renumber the rest.
 * Returns the promoted registration id, or null if nothing was promoted.
 */
export async function promoteNextWaitlisted(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<string | null> {
  const status = await getTournamentCapacityStatus(prisma, tournamentId);
  if (!status || !status.waitlistEnabled || status.spotsRemaining === 0) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const next = await tx.registration.findFirst({
      where: { tournamentId, waitlistStatus: 'waitlisted' },
      orderBy: { waitlistPosition: 'asc' },
      select: { id: true },
    });
    if (!next) return null;

    await tx.registration.update({
      where: { id: next.id },
      data: { waitlistStatus: 'promoted', waitlistPromotedAt: new Date(), waitlistPosition: null },
    });

    const remaining = await tx.registration.findMany({
      where: { tournamentId, waitlistStatus: 'waitlisted' },
      orderBy: { waitlistPosition: 'asc' },
      select: { id: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      await tx.registration.update({
        where: { id: remaining[i].id },
        data: { waitlistPosition: i + 1 },
      });
    }

    return next.id;
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

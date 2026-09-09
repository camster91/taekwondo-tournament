import type { PrismaClient } from '@prisma/client';
import { sendEmail, isEmailConfigured } from './email.js';
import { waitlistPromotionEmail } from './email-templates.js';

/**
 * Check if a tournament has reached its capacity. For now, this is a
 * simple global cap; in the future, we can add per-division caps.
 * Returns { shouldWaitlist: boolean, position: number | null }
 */
export async function checkWaitlistStatus(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ shouldWaitlist: boolean; position: number | null }> {
  // For Phase 2, we'll use a tournament-level setting for max competitors.
  // Later, division-level caps can be added.
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { settings: true },
  });

  if (!tournament?.settings) {
    return { shouldWaitlist: false, position: null };
  }

  let settings: { maxCompetitors?: number } = {};
  try {
    settings = JSON.parse(tournament.settings);
  } catch {
    return { shouldWaitlist: false, position: null };
  }

  const maxCompetitors = settings.maxCompetitors;
  if (!maxCompetitors || maxCompetitors <= 0) {
    return { shouldWaitlist: false, position: null };
  }

  // Count active registrations (not waitlisted, not withdrawn)
  const activeCount = await prisma.registration.count({
    where: {
      tournamentId,
      waitlistStatus: 'active',
    },
  });

  if (activeCount >= maxCompetitors) {
    // Calculate waitlist position
    const waitlistCount = await prisma.registration.count({
      where: {
        tournamentId,
        waitlistStatus: 'waitlisted',
      },
    });
    return { shouldWaitlist: true, position: waitlistCount + 1 };
  }

  return { shouldWaitlist: false, position: null };
}

/**
 * Promote the next waitlisted competitor when a spot opens up.
 * Returns the promoted registration or null if no one is waitlisted.
 */
export async function promoteNextWaitlisted(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<void> {
  // Find the next waitlisted competitor (lowest position)
  const nextWaitlisted = await prisma.registration.findFirst({
    where: {
      tournamentId,
      waitlistStatus: 'waitlisted',
    },
    orderBy: {
      waitlistPosition: 'asc',
    },
    include: {
      competitor: true,
      tournament: {
        select: {
          name: true,
          date: true,
          brandName: true,
          organization: {
            select: { brandName: true },
          },
        },
      },
    },
  });

  if (!nextWaitlisted) {
    return; // No one is waitlisted
  }

  // Generate a new management token for the promoted registration
  const { generateManagementToken, hashManagementToken } = await import('../utils/registration-management-token.js');
  const newManagementToken = generateManagementToken();

  // Promote them
  await prisma.registration.update({
    where: { id: nextWaitlisted.id },
    data: {
      waitlistStatus: 'active',
      waitlistPromotedAt: new Date(),
      waitlistPosition: null,
      managementTokenHash: hashManagementToken(newManagementToken),
    },
  });

  // Renumber the remaining waitlist
  const remaining = await prisma.registration.findMany({
    where: {
      tournamentId,
      waitlistStatus: 'waitlisted',
    },
    orderBy: {
      waitlistPosition: 'asc',
    },
  });

  for (let i = 0; i < remaining.length; i++) {
    await prisma.registration.update({
      where: { id: remaining[i].id },
      data: { waitlistPosition: i + 1 },
    });
  }

  // Send promotion email if configured
  if (nextWaitlisted.parentEmail && isEmailConfigured()) {
    const organizerBrandName =
      nextWaitlisted.tournament.brandName ||
      nextWaitlisted.tournament.organization?.brandName ||
      undefined;

    const managementUrl = `${process.env.PUBLIC_APP_URL || ''}/manage-registration?token=${encodeURIComponent(newManagementToken)}`;

    const { subject, html } = waitlistPromotionEmail({
      competitorName: `${nextWaitlisted.competitor.firstName} ${nextWaitlisted.competitor.lastName}`,
      tournamentName: nextWaitlisted.tournament.name,
      tournamentDate: nextWaitlisted.tournament.date,
      confirmationCode: nextWaitlisted.id.slice(0, 8),
      managementUrl,
      organizerBrandName,
    });

    sendEmail(nextWaitlisted.parentEmail, subject, html).catch((err) => {
      console.error('[waitlist] promotion email failed:', err);
    });
  }
}

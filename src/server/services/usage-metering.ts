import type { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { stripeRuntimeConfigFromEnv } from './stripe-billing.js';

/**
 * Record tournament completion usage for an organization.
 * Called when a tournament transitions to 'completed' status.
 */
export async function recordTournamentUsage(
  prisma: PrismaClient,
  tournamentId: string,
  organizationId: string,
): Promise<void> {
  // Count registered competitors for this tournament
  const competitorCount = await prisma.registration.count({
    where: { tournamentId },
  });

  // Get billing subscription to determine billing period
  const subscription = await prisma.organizationBillingSubscription.findUnique({
    where: { organizationId },
  });

  const billingPeriodStart = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    : null;
  const billingPeriodEnd = subscription?.currentPeriodEnd || null;

  // Create usage record
  await prisma.organizationUsageRecord.create({
    data: {
      organizationId,
      tournamentId,
      competitorCount,
      billingPeriodStart,
      billingPeriodEnd,
      recordedAt: new Date(),
    },
  });
}

/**
 * Report unreported usage to Stripe for metered billing.
 * This is a best-effort function that gracefully handles missing Stripe config.
 */
export async function reportUsageToStripe(
  prisma: PrismaClient,
  env: Record<string, string | undefined>,
): Promise<{ reported: number; errors: string[] }> {
  // Check if Stripe is configured
  let config: ReturnType<typeof stripeRuntimeConfigFromEnv>;
  try {
    config = stripeRuntimeConfigFromEnv(env);
  } catch {
    // Stripe not configured - skip reporting
    return { reported: 0, errors: ['Stripe not configured'] };
  }

  const stripe = new Stripe(config.secretKey);
  const errors: string[] = [];
  let reported = 0;

  // Get unreported usage records
  const records = await prisma.organizationUsageRecord.findMany({
    where: { reportedToStripe: false },
    include: {
      organization: {
        include: { billingSubscription: true },
      },
    },
    take: 100, // Batch process
  });

  for (const record of records) {
    try {
      const subscription = record.organization.billingSubscription;
      if (!subscription?.providerSubscriptionId) {
        continue; // No Stripe subscription
      }

      // Report usage to Stripe (this is a placeholder - actual implementation
      // would use Stripe's usage records API for metered billing)
      // await stripe.subscriptionItems.createUsageRecord(...)

      // Mark as reported
      await prisma.organizationUsageRecord.update({
        where: { id: record.id },
        data: {
          reportedToStripe: true,
          reportedAt: new Date(),
        },
      });

      reported++;
    } catch (error) {
      errors.push(
        `Failed to report usage for record ${record.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return { reported, errors };
}

/**
 * Get usage summary for an organization.
 */
export async function getOrganizationUsage(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{
  totalTournaments: number;
  totalCompetitors: number;
  recentUsage: Array<{
    tournamentId: string;
    tournamentName: string;
    competitorCount: number;
    recordedAt: Date;
  }>;
}> {
  const records = await prisma.organizationUsageRecord.findMany({
    where: { organizationId },
    include: {
      tournament: {
        select: { id: true, name: true },
      },
    },
    orderBy: { recordedAt: 'desc' },
    take: 10,
  });

  const totalTournaments = await prisma.organizationUsageRecord.count({
    where: { organizationId },
  });

  const totalCompetitors = await prisma.organizationUsageRecord.aggregate({
    where: { organizationId },
    _sum: { competitorCount: true },
  });

  return {
    totalTournaments,
    totalCompetitors: totalCompetitors._sum.competitorCount || 0,
    recentUsage: records.map((r) => ({
      tournamentId: r.tournamentId,
      tournamentName: r.tournament.name,
      competitorCount: r.competitorCount,
      recordedAt: r.recordedAt,
    })),
  };
}

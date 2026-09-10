import type { PrismaClient } from '@prisma/client';

/**
 * Check for expired grace periods and downgrade organizations.
 * Should be run periodically (e.g., daily cron job).
 */
export async function processExpiredGracePeriods(
  prisma: PrismaClient,
): Promise<{ downgraded: number; errors: string[] }> {
  const errors: string[] = [];
  let downgraded = 0;

  // Find subscriptions where grace period has expired
  const now = new Date();
  const expiredSubscriptions = await prisma.organizationBillingSubscription.findMany({
    where: {
      gracePeriodEndsAt: {
        lte: now,
      },
      paymentFailedAt: {
        not: null,
      },
    },
    include: {
      organization: true,
    },
  });

  for (const subscription of expiredSubscriptions) {
    try {
      await prisma.$transaction(async (tx) => {
        // Downgrade organization to free plan
        await tx.organization.update({
          where: { id: subscription.organizationId },
          data: { plan: 'free' },
        });

        // Record plan change
        await tx.organizationPlanChange.create({
          data: {
            organizationId: subscription.organizationId,
            fromPlan: subscription.organization.plan,
            toPlan: 'free',
            source: 'stripe',
            reason: `Grace period expired after payment failure on ${subscription.paymentFailedAt?.toISOString()}`,
          },
        });

        // Clear grace period fields
        await tx.organizationBillingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'past_due',
            gracePeriodEndsAt: null,
            lastPaymentFailureReason: null,
          },
        });
      });

      downgraded++;
    } catch (error) {
      errors.push(
        `Failed to downgrade organization ${subscription.organizationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return { downgraded, errors };
}

/**
 * Get organizations currently in grace period.
 */
export async function getOrganizationsInGracePeriod(
  prisma: PrismaClient,
): Promise<
  Array<{
    organizationId: string;
    organizationName: string;
    paymentFailedAt: Date;
    gracePeriodEndsAt: Date;
    daysRemaining: number;
  }>
> {
  const now = new Date();
  const subscriptions = await prisma.organizationBillingSubscription.findMany({
    where: {
      gracePeriodEndsAt: {
        gt: now,
      },
      paymentFailedAt: {
        not: null,
      },
    },
    include: {
      organization: {
        select: { id: true, name: true },
      },
    },
  });

  return subscriptions.map((sub) => ({
    organizationId: sub.organizationId,
    organizationName: sub.organization.name,
    paymentFailedAt: sub.paymentFailedAt!,
    gracePeriodEndsAt: sub.gracePeriodEndsAt!,
    daysRemaining: Math.ceil(
      (sub.gracePeriodEndsAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    ),
  }));
}

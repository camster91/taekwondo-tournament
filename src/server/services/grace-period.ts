import type { PrismaClient } from '@prisma/client';

/**
 * Only a subscription Stripe still bills can be in a payment grace period.
 * A final status (canceled, unpaid, incomplete_expired) set by the webhook
 * must never be overwritten by the downgrade job.
 */
export const GRACE_PERIOD_STATUSES = ['active', 'trialing', 'past_due'];

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
      status: { in: GRACE_PERIOD_STATUSES },
    },
    include: {
      organization: true,
    },
  });

  for (const subscription of expiredSubscriptions) {
    try {
      const claimed = await prisma.$transaction(async (tx) => {
        // Claim the expired grace period first so two containers (or an
        // overlapping run) downgrade and record the plan change only once.
        const claim = await tx.organizationBillingSubscription.updateMany({
          where: {
            id: subscription.id,
            gracePeriodEndsAt: { lte: now },
            paymentFailedAt: { not: null },
            status: { in: GRACE_PERIOD_STATUSES },
          },
          data: {
            status: 'past_due',
            gracePeriodEndsAt: null,
            lastPaymentFailureReason: null,
          },
        });
        if (claim.count !== 1) return false;

        // Downgrade organization to free plan
        await tx.organization.update({
          where: { id: subscription.organizationId },
          data: { plan: 'free' },
        });

        // Record plan change (a past_due webhook after expiry may already
        // have moved the org to free)
        if (subscription.organization.plan === 'free') return true;
        await tx.organizationPlanChange.create({
          data: {
            organizationId: subscription.organizationId,
            fromPlan: subscription.organization.plan,
            toPlan: 'free',
            source: 'stripe',
            reason: `Grace period expired after payment failure on ${subscription.paymentFailedAt?.toISOString()}`,
          },
        });

        return true;
      });

      if (claimed) downgraded++;
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

type GracePeriodLogger = Pick<Console, 'info' | 'error'>;
type GracePeriodScheduler = (callback: () => void, ms: number) => { unref?: () => void };

export const GRACE_PERIOD_JOB_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Run the grace-period downgrade at startup and then hourly, in-process.
 * Rows only exist after a Stripe payment failure, so this is a no-op for
 * deployments without billing. Hourly (not daily) keeps a restarted
 * container from delaying a downgrade by up to a day.
 */
export async function startGracePeriodJob({
  database,
  intervalMs = GRACE_PERIOD_JOB_INTERVAL_MS,
  schedule = setInterval,
  logger = console,
}: {
  database: PrismaClient;
  intervalMs?: number;
  schedule?: GracePeriodScheduler;
  logger?: GracePeriodLogger;
}): Promise<void> {
  const run = async () => {
    try {
      const result = await processExpiredGracePeriods(database);
      if (result.downgraded > 0) {
        logger.info(`[grace-period] downgraded ${result.downgraded} organization(s) after an expired payment grace period`);
      }
      for (const error of result.errors) logger.error(`[grace-period] ${error}`);
    } catch (error) {
      logger.error('[grace-period] run failed', error);
    }
  };

  await run();
  const timer = schedule(() => void run(), intervalMs);
  timer.unref?.();
}

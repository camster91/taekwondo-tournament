import type { PlanName } from './entitlements.js';

export type PlanTier =
  | 'starter'
  | 'pro'
  | 'per_event_small'
  | 'per_event_medium'
  | 'per_event_large';

export type StripePriceMap = Readonly<Record<string, PlanTier>>;

export function checkoutPlanFromInput(value: unknown): PlanTier {
  const validPlans: PlanTier[] = [
    'starter',
    'pro',
    'per_event_small',
    'per_event_medium',
    'per_event_large',
  ];
  if (typeof value === 'string' && validPlans.includes(value as PlanTier)) {
    return value as PlanTier;
  }
  throw new Error('Plan must be one of: starter, pro, per_event_small, per_event_medium, per_event_large');
}

export function stripePriceMapFromEnv(
  env: Record<string, string | undefined>,
): StripePriceMap {
  const starter = env.STRIPE_STARTER_PRICE_ID?.trim();
  const pro = env.STRIPE_PRO_PRICE_ID?.trim();
  const perEventSmall = env.STRIPE_PER_EVENT_SMALL_PRICE_ID?.trim();
  const perEventMedium = env.STRIPE_PER_EVENT_MEDIUM_PRICE_ID?.trim();
  const perEventLarge = env.STRIPE_PER_EVENT_LARGE_PRICE_ID?.trim();

  // Collect all non-empty price IDs
  const allIds: string[] = [];
  if (starter) allIds.push(starter);
  if (pro) allIds.push(pro);
  if (perEventSmall) allIds.push(perEventSmall);
  if (perEventMedium) allIds.push(perEventMedium);
  if (perEventLarge) allIds.push(perEventLarge);

  // Require at least one price ID to be configured
  if (allIds.length === 0) {
    throw new Error('At least one Stripe price ID must be configured (STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID, or STRIPE_PER_EVENT_*_PRICE_ID)');
  }

  // Ensure all configured IDs are unique
  const uniqueIds = new Set(allIds);
  if (allIds.length !== uniqueIds.size) {
    throw new Error('All configured Stripe price IDs must be distinct');
  }

  // Build map with available price IDs
  const map: Record<string, PlanTier> = {};
  if (starter) map[starter] = 'starter';
  if (pro) map[pro] = 'pro';
  if (perEventSmall) map[perEventSmall] = 'per_event_small';
  if (perEventMedium) map[perEventMedium] = 'per_event_medium';
  if (perEventLarge) map[perEventLarge] = 'per_event_large';

  return map;
}

export function stripeRuntimeConfigFromEnv(env: Record<string, string | undefined>): {
  secretKey: string;
  webhookSecret: string;
  prices: StripePriceMap;
} {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required');
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is required');
  return { secretKey, webhookSecret, prices: stripePriceMapFromEnv(env) };
}

type StripeSubscriptionShape = {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: number | null;
  metadata: Record<string, string | undefined>;
  items: { data: Array<{ price: { id: string } }> };
};

export type MappedSubscription = {
  organizationId: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
  status: string;
  plan: PlanTier;
  effectivePlan: PlanName;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

export function mapStripeSubscription(
  subscription: StripeSubscriptionShape,
  prices: StripePriceMap,
): MappedSubscription {
  const organizationId = subscription.metadata.organizationId?.trim();
  if (!organizationId) throw new Error('Stripe subscription metadata.organizationId is required');
  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? prices[priceId] : undefined;
  if (!plan) throw new Error('Stripe subscription uses an unknown price');
  const providerCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
  const entitled = subscription.status === 'active' || subscription.status === 'trialing';

  // Map subscription tier to org plan
  let effectivePlan: PlanName;
  if (!entitled) {
    effectivePlan = 'free';
  } else if (plan === 'starter' || plan === 'pro') {
    effectivePlan = plan;
  } else {
    // Per-event subscriptions map to 'starter' plan for entitlements
    // since they're event-based and not seat-based
    effectivePlan = 'starter';
  }

  return {
    organizationId,
    providerCustomerId,
    providerSubscriptionId: subscription.id,
    status: subscription.status,
    plan,
    effectivePlan,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
  };
}

export function getPriceIdForTier(
  tier: PlanTier,
  env: Record<string, string | undefined>,
): string | null {
  switch (tier) {
    case 'starter':
      return env.STRIPE_STARTER_PRICE_ID?.trim() || null;
    case 'pro':
      return env.STRIPE_PRO_PRICE_ID?.trim() || null;
    case 'per_event_small':
      return env.STRIPE_PER_EVENT_SMALL_PRICE_ID?.trim() || null;
    case 'per_event_medium':
      return env.STRIPE_PER_EVENT_MEDIUM_PRICE_ID?.trim() || null;
    case 'per_event_large':
      return env.STRIPE_PER_EVENT_LARGE_PRICE_ID?.trim() || null;
    default:
      return null;
  }
}

/**
 * Best-effort expiry of a previously created Checkout session so a parent
 * cannot pay for the same registration twice from an older tab. Errors
 * (session already completed/expired, unknown id, network) are swallowed:
 * a completed session is still honoured by the webhook, and failing to
 * expire must never block creating the replacement session.
 */
export async function expireCheckoutSessionBestEffort(
  stripe: { checkout: { sessions: { expire: (id: string) => Promise<unknown> } } },
  sessionId: string | null | undefined,
): Promise<boolean> {
  if (!sessionId || !sessionId.startsWith('cs_')) return false;
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[stripe] could not expire previous checkout session ${sessionId}: ${message}`);
    return false;
  }
}

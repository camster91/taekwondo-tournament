import type { PlanName } from './entitlements.js';

export type StripePriceMap = Readonly<Record<string, 'starter' | 'pro'>>;

export function checkoutPlanFromInput(value: unknown): 'starter' | 'pro' {
  if (value === 'starter' || value === 'pro') return value;
  throw new Error('Plan must be starter or pro');
}

export function stripePriceMapFromEnv(
  env: Record<string, string | undefined>,
): StripePriceMap {
  const starter = env.STRIPE_STARTER_PRICE_ID?.trim();
  const pro = env.STRIPE_PRO_PRICE_ID?.trim();
  if (!starter) throw new Error('STRIPE_STARTER_PRICE_ID is required');
  if (!pro) throw new Error('STRIPE_PRO_PRICE_ID is required');
  if (starter === pro) throw new Error('Stripe starter and pro price IDs must be distinct');
  return { [starter]: 'starter', [pro]: 'pro' };
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
  plan: 'starter' | 'pro';
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
  return {
    organizationId,
    providerCustomerId,
    providerSubscriptionId: subscription.id,
    status: subscription.status,
    plan,
    effectivePlan: entitled ? plan : 'free',
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
  };
}

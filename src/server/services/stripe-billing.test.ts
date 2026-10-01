import { describe, expect, it } from 'vitest';
import {
  checkoutPlanFromInput,
  mapStripeSubscription,
  resolveSubscriptionGrace,
  stripeRuntimeConfigFromEnv,
  stripePriceMapFromEnv,
} from './stripe-billing.js';

describe('checkoutPlanFromInput', () => {
  it('accepts purchasable self-service plans including per-event tiers', () => {
    expect(checkoutPlanFromInput('starter')).toBe('starter');
    expect(checkoutPlanFromInput('pro')).toBe('pro');
    expect(checkoutPlanFromInput('per_event_small')).toBe('per_event_small');
    expect(checkoutPlanFromInput('per_event_medium')).toBe('per_event_medium');
    expect(checkoutPlanFromInput('per_event_large')).toBe('per_event_large');
    expect(() => checkoutPlanFromInput('free')).toThrow(/one of:/);
    expect(() => checkoutPlanFromInput(undefined)).toThrow(/one of:/);
  });
});

const env = {
  STRIPE_STARTER_PRICE_ID: 'price_starter',
  STRIPE_PRO_PRICE_ID: 'price_pro',
};

describe('stripePriceMapFromEnv', () => {
  it('builds a map from configured price IDs and requires at least one', () => {
    // At least one price ID required
    expect(() => stripePriceMapFromEnv({})).toThrow(/At least one/);
    
    // Distinct IDs required
    expect(() => stripePriceMapFromEnv({
      STRIPE_STARTER_PRICE_ID: 'same',
      STRIPE_PRO_PRICE_ID: 'same',
    })).toThrow(/distinct/);
    
    // Should accept starter only
    const starterOnly = stripePriceMapFromEnv({
      STRIPE_STARTER_PRICE_ID: 'price_starter',
    });
    expect(starterOnly['price_starter']).toBe('starter');
    
    // Should accept all types
    const allPrices = stripePriceMapFromEnv({
      STRIPE_STARTER_PRICE_ID: 'price_starter',
      STRIPE_PRO_PRICE_ID: 'price_pro',
      STRIPE_PER_EVENT_SMALL_PRICE_ID: 'price_small',
      STRIPE_PER_EVENT_MEDIUM_PRICE_ID: 'price_medium',
      STRIPE_PER_EVENT_LARGE_PRICE_ID: 'price_large',
    });
    expect(Object.keys(allPrices)).toHaveLength(5);
  });
});

describe('stripeRuntimeConfigFromEnv', () => {
  it('requires secret and webhook keys together with the plan prices', () => {
    expect(() => stripeRuntimeConfigFromEnv(env)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => stripeRuntimeConfigFromEnv({ ...env, STRIPE_SECRET_KEY: 'sk_test_123' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('returns a complete Stripe billing configuration', () => {
    expect(stripeRuntimeConfigFromEnv({
      ...env,
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
    })).toMatchObject({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      prices: { price_starter: 'starter', price_pro: 'pro' },
    });
  });
});

describe('mapStripeSubscription', () => {
  it('activates the plan attached to a known price', () => {
    expect(mapStripeSubscription({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1_800_000_000,
      metadata: { organizationId: 'org_123' },
      items: { data: [{ price: { id: 'price_starter' } }] },
    }, stripePriceMapFromEnv(env))).toEqual({
      organizationId: 'org_123',
      providerCustomerId: 'cus_123',
      providerSubscriptionId: 'sub_123',
      status: 'active',
      plan: 'starter',
      effectivePlan: 'starter',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(1_800_000_000_000),
    });
  });

  it('fails closed to free when payment state is not active or trialing', () => {
    const result = mapStripeSubscription({
      id: 'sub_past_due',
      customer: { id: 'cus_123' },
      status: 'past_due',
      cancel_at_period_end: true,
      current_period_end: null,
      metadata: { organizationId: 'org_123' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    }, stripePriceMapFromEnv(env));

    expect(result.plan).toBe('pro');
    expect(result.effectivePlan).toBe('free');
    expect(result.providerCustomerId).toBe('cus_123');
  });

  it('rejects missing organization metadata and unknown prices', () => {
    const base = {
      id: 'sub_123', customer: 'cus_123', status: 'active', cancel_at_period_end: false,
      current_period_end: null, metadata: {}, items: { data: [{ price: { id: 'price_unknown' } }] },
    };
    expect(() => mapStripeSubscription(base, stripePriceMapFromEnv(env))).toThrow(/organizationId/);
    expect(() => mapStripeSubscription({ ...base, metadata: { organizationId: 'org_123' } }, stripePriceMapFromEnv(env))).toThrow(/price/);
  });
});

describe('resolveSubscriptionGrace', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const mapped = (status: string) => ({ status, plan: 'pro' as const, effectivePlan: status === 'active' ? 'pro' as const : 'free' as const });

  it('keeps the paid plan and starts the 7-day clock on the first past_due signal', () => {
    const decision = resolveSubscriptionGrace(mapped('past_due'), { paymentFailedAt: null, gracePeriodEndsAt: null }, now);
    expect(decision.effectivePlan).toBe('pro');
    expect(decision.grace.paymentFailedAt).toEqual(now);
    expect(decision.grace.gracePeriodEndsAt!.getTime() - now.getTime()).toBe(7 * day);
  });

  it('keeps the paid plan during a running grace period without extending it', () => {
    const decision = resolveSubscriptionGrace(mapped('past_due'), {
      paymentFailedAt: new Date(now.getTime() - 2 * day),
      gracePeriodEndsAt: new Date(now.getTime() + 5 * day),
    }, now);
    expect(decision).toEqual({ effectivePlan: 'pro', grace: {} });
  });

  it('agrees with the grace-period job once the period has expired', () => {
    // Expired but the hourly job has not run yet
    expect(resolveSubscriptionGrace(mapped('past_due'), {
      paymentFailedAt: new Date(now.getTime() - 8 * day),
      gracePeriodEndsAt: new Date(now.getTime() - day),
    }, now)).toEqual({ effectivePlan: 'free', grace: {} });
    // The job cleared gracePeriodEndsAt after downgrading
    expect(resolveSubscriptionGrace(mapped('past_due'), {
      paymentFailedAt: new Date(now.getTime() - 8 * day),
      gracePeriodEndsAt: null,
    }, now)).toEqual({ effectivePlan: 'free', grace: {} });
  });

  it('clears the grace period when the subscription recovers', () => {
    expect(resolveSubscriptionGrace(mapped('active'), {
      paymentFailedAt: new Date(now.getTime() - day),
      gracePeriodEndsAt: new Date(now.getTime() + 6 * day),
    }, now)).toEqual({
      effectivePlan: 'pro',
      grace: { paymentFailedAt: null, gracePeriodEndsAt: null, lastPaymentFailureReason: null },
    });
    expect(resolveSubscriptionGrace(mapped('active'), null, now)).toEqual({ effectivePlan: 'pro', grace: {} });
  });

  it('drops to free and clears the grace period for final statuses', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
      expect(resolveSubscriptionGrace(mapped(status), {
        paymentFailedAt: new Date(now.getTime() - day),
        gracePeriodEndsAt: new Date(now.getTime() + 6 * day),
      }, now)).toEqual({ effectivePlan: 'free', grace: { paymentFailedAt: null, gracePeriodEndsAt: null } });
    }
  });

  it('gives incomplete subscriptions no plan and no grace period', () => {
    expect(resolveSubscriptionGrace(mapped('incomplete'), null, now)).toEqual({ effectivePlan: 'free', grace: {} });
  });
});

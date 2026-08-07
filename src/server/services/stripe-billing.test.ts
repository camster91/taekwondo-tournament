import { describe, expect, it } from 'vitest';
import {
  checkoutPlanFromInput,
  mapStripeSubscription,
  stripeRuntimeConfigFromEnv,
  stripePriceMapFromEnv,
} from './stripe-billing.js';

describe('checkoutPlanFromInput', () => {
  it('accepts only purchasable self-service plans', () => {
    expect(checkoutPlanFromInput('starter')).toBe('starter');
    expect(checkoutPlanFromInput('pro')).toBe('pro');
    expect(() => checkoutPlanFromInput('free')).toThrow(/starter or pro/);
    expect(() => checkoutPlanFromInput(undefined)).toThrow(/starter or pro/);
  });
});

const env = {
  STRIPE_STARTER_PRICE_ID: 'price_starter',
  STRIPE_PRO_PRICE_ID: 'price_pro',
};

describe('stripePriceMapFromEnv', () => {
  it('requires distinct configured price IDs', () => {
    expect(() => stripePriceMapFromEnv({})).toThrow(/STRIPE_STARTER_PRICE_ID/);
    expect(() => stripePriceMapFromEnv({
      STRIPE_STARTER_PRICE_ID: 'same',
      STRIPE_PRO_PRICE_ID: 'same',
    })).toThrow(/distinct/);
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

/**
 * Stripe may deliver customer.subscription.* events out of order. A late
 * `updated(active)` arriving after `deleted` must not re-grant the plan, so
 * the handler applies the subscription's current state fetched from
 * Stripe, not the event snapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const retrieve = vi.hoisted(() => vi.fn());

vi.mock('stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stripe')>();
  const RealStripe = actual.default as unknown as new (...args: unknown[]) => Record<string, unknown>;
  class MockedStripe extends RealStripe {
    constructor(...args: unknown[]) {
      super(...args);
      this.subscriptions = { retrieve };
    }
  }
  return { default: MockedStripe };
});

const { default: Stripe } = await import('stripe');
const { stripeWebhookHandler, trustSubscriptionEventPayload } = await import('./billing.js');

const WEBHOOK_SECRET = 'whsec_test_subscription';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

function subscription(status: string) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status,
    cancel_at_period_end: false,
    current_period_end: 1_900_000_000,
    metadata: { organizationId: ORG_ID },
    items: { data: [{ price: { id: 'price_starter_test' } }] },
  };
}

describe('subscription webhooks apply Stripe’s current state', () => {
  let tx: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_subscription');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    vi.stubEnv('STRIPE_STARTER_PRICE_ID', 'price_starter_test');
    vi.stubEnv('STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD', '');
    retrieve.mockReset();
    tx = {
      billingWebhookEvent: { create: vi.fn().mockResolvedValue({}) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: ORG_ID, plan: 'free' }),
        update: vi.fn().mockResolvedValue({}),
      },
      organizationBillingSubscription: { upsert: vi.fn().mockResolvedValue({}) },
      organizationPlanChange: { create: vi.fn().mockResolvedValue({}) },
    };
    app = express();
    app.locals.prisma = {
      billingWebhookEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function send(type: string, object: Record<string, unknown>) {
    const payload = JSON.stringify({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      object: 'event',
      type,
      data: { object },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  it('a stale "active" update arriving after cancellation keeps the org on free', async () => {
    retrieve.mockResolvedValue(subscription('canceled'));
    const res = await send('customer.subscription.updated', subscription('active'));
    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'free' } });
    expect(tx.organizationBillingSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'canceled' }),
    }));
  });

  it('grants the plan when Stripe confirms the subscription is active', async () => {
    retrieve.mockResolvedValue(subscription('active'));
    const res = await send('customer.subscription.created', subscription('incomplete'));
    expect(res.status).toBe(200);
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'starter' } });
  });

  it('asks Stripe to redeliver (503) when the subscription cannot be fetched, recording nothing', async () => {
    retrieve.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await send('customer.subscription.updated', subscription('active'));
    expect(res.status).toBe(503);
    expect(tx.billingWebhookEvent.create).not.toHaveBeenCalled();
    expect(tx.organization.update).not.toHaveBeenCalled();
  });

  it('applies a deleted event’s payload when Stripe no longer has the subscription', async () => {
    retrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }));
    const res = await send('customer.subscription.deleted', subscription('canceled'));
    expect(res.status).toBe(200);
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'free' } });
  });

  it('only trusts the raw payload behind the non-production test switch', () => {
    expect(trustSubscriptionEventPayload({ STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD: '1', NODE_ENV: 'test' })).toBe(true);
    expect(trustSubscriptionEventPayload({ STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD: '1', NODE_ENV: 'production' })).toBe(false);
    expect(trustSubscriptionEventPayload({})).toBe(false);
  });
});

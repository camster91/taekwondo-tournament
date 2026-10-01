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
const cancel = vi.hoisted(() => vi.fn());

vi.mock('stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stripe')>();
  const RealStripe = actual.default as unknown as new (...args: unknown[]) => Record<string, unknown>;
  class MockedStripe extends RealStripe {
    constructor(...args: unknown[]) {
      super(...args);
      this.subscriptions = { retrieve, cancel };
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
      organizationBillingSubscription: {
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      organizationPlanChange: { create: vi.fn().mockResolvedValue({}) },
      organizationMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    app = express();
    cancel.mockReset();
    app.locals.prisma = {
      organization: { findUnique: vi.fn().mockResolvedValue({ id: ORG_ID }) },
      billingWebhookEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      organizationBillingSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
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

  it('cancels an active subscription whose organization was deleted', async () => {
    (app.locals.prisma as { organization: { findUnique: ReturnType<typeof vi.fn> } }).organization.findUnique.mockResolvedValue(null);
    retrieve.mockResolvedValue(subscription('active'));
    cancel.mockResolvedValue({});
    const res = await send('customer.subscription.created', subscription('active'));
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith('sub_1');
    expect(tx.organization.update).not.toHaveBeenCalled();
  });

  it('only trusts the raw payload behind the non-production test switch', () => {
    expect(trustSubscriptionEventPayload({ STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD: '1', NODE_ENV: 'test' })).toBe(true);
    expect(trustSubscriptionEventPayload({ STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD: '1', NODE_ENV: 'production' })).toBe(false);
    expect(trustSubscriptionEventPayload({})).toBe(false);
  });

  it('a canceled subscription clears the grace period so the hourly job never revives it', async () => {
    tx.organization.findUnique.mockResolvedValue({ id: ORG_ID, plan: 'starter' });
    tx.organizationBillingSubscription.findUnique.mockResolvedValue({
      paymentFailedAt: new Date(Date.now() - 86_400_000),
      gracePeriodEndsAt: new Date(Date.now() + 6 * 86_400_000),
    });
    retrieve.mockResolvedValue(subscription('canceled'));
    const res = await send('customer.subscription.deleted', subscription('canceled'));
    expect(res.status).toBe(200);
    expect(tx.organizationBillingSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'canceled', paymentFailedAt: null, gracePeriodEndsAt: null }),
    }));
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'free' } });
  });

  it('keeps the paid plan while past_due inside the grace period', async () => {
    tx.organization.findUnique.mockResolvedValue({ id: ORG_ID, plan: 'starter' });
    tx.organizationBillingSubscription.findUnique.mockResolvedValue({
      paymentFailedAt: new Date(Date.now() - 86_400_000),
      gracePeriodEndsAt: new Date(Date.now() + 6 * 86_400_000),
    });
    retrieve.mockResolvedValue(subscription('past_due'));
    const res = await send('customer.subscription.updated', subscription('past_due'));
    expect(res.status).toBe(200);
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'starter' } });
    expect(tx.organizationPlanChange.create).not.toHaveBeenCalled();
    const upsert = tx.organizationBillingSubscription.upsert.mock.calls[0][0];
    expect(upsert.update).not.toHaveProperty('gracePeriodEndsAt');
  });

  it('starts the grace period when past_due arrives before invoice.payment_failed', async () => {
    tx.organization.findUnique.mockResolvedValue({ id: ORG_ID, plan: 'starter' });
    retrieve.mockResolvedValue(subscription('past_due'));
    const res = await send('customer.subscription.updated', subscription('past_due'));
    expect(res.status).toBe(200);
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'starter' } });
    const upsert = tx.organizationBillingSubscription.upsert.mock.calls[0][0];
    expect(upsert.update.paymentFailedAt).toBeInstanceOf(Date);
    expect(upsert.update.gracePeriodEndsAt.getTime() - upsert.update.paymentFailedAt.getTime())
      .toBe(7 * 86_400_000);
  });

  it('downgrades a past_due subscription whose grace period has expired', async () => {
    tx.organization.findUnique.mockResolvedValue({ id: ORG_ID, plan: 'starter' });
    tx.organizationBillingSubscription.findUnique.mockResolvedValue({
      paymentFailedAt: new Date(Date.now() - 8 * 86_400_000),
      gracePeriodEndsAt: null,
    });
    retrieve.mockResolvedValue(subscription('past_due'));
    await send('customer.subscription.updated', subscription('past_due'));
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'free' } });
  });

  describe('invoice events', () => {
    const invoice = () => ({ id: 'in_1', object: 'invoice', customer: 'cus_1', subscription: 'sub_1' });
    const billingRow = (overrides: Record<string, unknown>) => ({
      id: 'billing-1', organizationId: ORG_ID, status: 'past_due',
      paymentFailedAt: null, gracePeriodEndsAt: null, organization: { name: 'Org' }, ...overrides,
    });

    it('starts the grace period on the first failure', async () => {
      app.locals.prisma.organizationBillingSubscription.findUnique.mockResolvedValue(billingRow({}));
      const res = await send('invoice.payment_failed', invoice());
      expect(res.status).toBe(200);
      const call = tx.organizationBillingSubscription.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'billing-1', paymentFailedAt: null });
      expect(call.data.gracePeriodEndsAt.getTime() - call.data.paymentFailedAt.getTime()).toBe(7 * 86_400_000);
    });

    it('does not push the deadline out on a Stripe retry', async () => {
      app.locals.prisma.organizationBillingSubscription.findUnique.mockResolvedValue(billingRow({
        paymentFailedAt: new Date(Date.now() - 3 * 86_400_000),
        gracePeriodEndsAt: new Date(Date.now() + 4 * 86_400_000),
      }));
      const res = await send('invoice.payment_failed', invoice());
      expect(res.status).toBe(200);
      expect(tx.organizationBillingSubscription.updateMany).not.toHaveBeenCalled();
      for (const [arg] of tx.organizationBillingSubscription.update.mock.calls) {
        expect(arg.data).not.toHaveProperty('gracePeriodEndsAt');
        expect(arg.data).not.toHaveProperty('paymentFailedAt');
      }
    });

    it('gives a canceled subscription no grace period', async () => {
      app.locals.prisma.organizationBillingSubscription.findUnique.mockResolvedValue(billingRow({ status: 'canceled' }));
      await send('invoice.payment_failed', invoice());
      expect(tx.organizationBillingSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('clears the grace period on a successful payment', async () => {
      app.locals.prisma.organizationBillingSubscription.findUnique.mockResolvedValue(billingRow({
        paymentFailedAt: new Date(), gracePeriodEndsAt: new Date(),
      }));
      await send('invoice.payment_succeeded', invoice());
      expect(tx.organizationBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: 'billing-1' },
        data: { paymentFailedAt: null, gracePeriodEndsAt: null, lastPaymentFailureReason: null },
      });
    });
  });
});

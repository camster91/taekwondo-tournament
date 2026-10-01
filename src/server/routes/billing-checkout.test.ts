/**
 * Starting a Stripe Checkout must not mark the organization as having a
 * subscription: until the webhook reports one, an abandoned checkout has
 * to leave the organization deletable, and a later successful checkout
 * must still activate the plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const stripeMocks = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock('stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stripe')>();
  const RealStripe = actual.default as unknown as new (...args: unknown[]) => Record<string, unknown>;
  class MockedStripe extends RealStripe {
    constructor(...args: unknown[]) {
      super(...args);
      this.customers = { create: stripeMocks.customersCreate };
      this.checkout = { sessions: { create: stripeMocks.sessionsCreate } };
      this.subscriptions = { retrieve: stripeMocks.retrieve };
    }
  }
  return { default: MockedStripe };
});

vi.mock('../middleware/auth.js', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'owner-1', role: 'director' };
    next();
  },
}));

const { default: Stripe } = await import('stripe');
const { default: billingRouter, stripeWebhookHandler } = await import('./billing.js');
const { validateOrganizationDeletion } = await import('../services/organization-closure.js');

const WEBHOOK_SECRET = 'whsec_test_checkout';
const ORG_ID = '44444444-4444-4444-8444-444444444444';

describe('subscription checkout leaves billing state to the webhook', () => {
  let billingRow: Record<string, unknown> | null;
  let prisma: Record<string, any>;
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_checkout');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    vi.stubEnv('STRIPE_STARTER_PRICE_ID', 'price_starter_checkout');
    vi.stubEnv('STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD', '');
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.test');
    stripeMocks.customersCreate.mockReset().mockResolvedValue({ id: 'cus_new' });
    stripeMocks.sessionsCreate.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.test/s' });
    stripeMocks.retrieve.mockReset();
    billingRow = null;

    // A tiny in-memory billing table so checkout and webhook see each other's writes.
    const upsert = vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      billingRow = billingRow
        ? { ...billingRow, ...update }
        : { status: 'inactive', providerSubscriptionId: null, paymentFailedAt: null, gracePeriodEndsAt: null, ...create };
      return billingRow;
    });
    const tx = {
      billingWebhookEvent: { create: vi.fn().mockResolvedValue({}) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: ORG_ID, plan: 'free' }),
        update: vi.fn().mockResolvedValue({}),
      },
      organizationBillingSubscription: {
        upsert,
        findUnique: vi.fn(async () => billingRow),
      },
      organizationPlanChange: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma = {
      tx,
      organizationMember: {
        findUnique: vi.fn(async () => ({
          role: 'owner',
          organization: { id: ORG_ID, name: 'Northside', billingSubscription: billingRow },
        })),
      },
      organizationBillingSubscription: { upsert },
      billingWebhookEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    app = express();
    app.locals.prisma = prisma;
    app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
    app.use(express.json());
    app.use('/billing', billingRouter);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function deletion() {
    const row = billingRow as { status?: string; providerSubscriptionId?: string | null } | null;
    return validateOrganizationDeletion({
      slug: 'northside',
      confirmation: 'northside',
      exportAcknowledged: true,
      billingStatus: row?.status ?? null,
      providerSubscriptionId: row?.providerSubscriptionId ?? null,
    });
  }

  it('an abandoned checkout keeps the organization deletable', async () => {
    const res = await request(app).post('/billing/checkout').send({ organizationId: ORG_ID, plan: 'starter' });
    expect(res.status).toBe(201);
    expect(billingRow).toMatchObject({ providerCustomerId: 'cus_new', status: 'inactive', providerSubscriptionId: null });
    expect(deletion()).toEqual({ ok: true });

    // Retrying checkout reuses the customer and is not blocked.
    const retry = await request(app).post('/billing/checkout').send({ organizationId: ORG_ID, plan: 'starter' });
    expect(retry.status).toBe(201);
    expect(stripeMocks.customersCreate).toHaveBeenCalledTimes(1);
  });

  it('a completed checkout is still activated by the subscription webhook', async () => {
    await request(app).post('/billing/checkout').send({ organizationId: ORG_ID, plan: 'starter' });

    const active = {
      id: 'sub_new',
      object: 'subscription',
      customer: 'cus_new',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1_900_000_000,
      metadata: { organizationId: ORG_ID },
      items: { data: [{ price: { id: 'price_starter_checkout' } }] },
    };
    stripeMocks.retrieve.mockResolvedValue(active);
    const payload = JSON.stringify({ id: 'evt_checkout_1', object: 'event', type: 'customer.subscription.created', data: { object: active } });
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }))
      .send(payload);

    expect(res.status).toBe(200);
    expect(billingRow).toMatchObject({ status: 'active', providerSubscriptionId: 'sub_new', plan: 'starter' });
    expect(prisma.tx.organization.update).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { plan: 'starter' } });
    expect(deletion()).toMatchObject({ ok: false, status: 409 });

    // And a second checkout is refused while the subscription is live.
    const again = await request(app).post('/billing/checkout').send({ organizationId: ORG_ID, plan: 'starter' });
    expect(again.status).toBe(409);
  });
});

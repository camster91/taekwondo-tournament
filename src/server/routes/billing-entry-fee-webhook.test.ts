/**
 * Regression tests for entry-fee checkout.session.completed handling:
 * any server-created (metadata-tagged) paid session for the registration
 * marks it paid — including an older session superseded by a later
 * /checkout call — but only when the charged amount/currency match, and events that can never
 * succeed (unknown registration, mismatches) are acknowledged with 2xx so
 * Stripe stops retrying.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { evaluateEntryFeeSession, stripeWebhookHandler } from './billing.js';

const WEBHOOK_SECRET = 'whsec_test_entry_fee';

describe('evaluateEntryFeeSession', () => {
  const reg = { paymentStatus: 'pending', paymentIntentId: 'cs_1', paymentAmountCents: 2500 };
  const session = { id: 'cs_1', payment_status: 'paid', amount_total: 2500, currency: 'usd' };

  it('marks paid only when session id and amount match', () => {
    expect(evaluateEntryFeeSession(reg, session)).toEqual({ action: 'mark_paid' });
  });

  it('ignores unknown registrations', () => {
    expect(evaluateEntryFeeSession(null, session)).toEqual({ action: 'ignore', reason: 'unknown_registration' });
  });

  it('marks paid for an older session that was superseded by a newer checkout', () => {
    expect(evaluateEntryFeeSession({ ...reg, paymentIntentId: 'cs_newer' }, session))
      .toEqual({ action: 'mark_paid' });
    expect(evaluateEntryFeeSession({ ...reg, paymentIntentId: null }, session))
      .toEqual({ action: 'mark_paid' });
  });

  it('ignores amount and currency mismatches', () => {
    expect(evaluateEntryFeeSession(reg, { ...session, amount_total: 1 }))
      .toEqual({ action: 'ignore', reason: 'amount_mismatch' });
    expect(evaluateEntryFeeSession({ ...reg, paymentAmountCents: null }, session))
      .toEqual({ action: 'ignore', reason: 'amount_mismatch' });
    expect(evaluateEntryFeeSession(reg, { ...session, currency: 'eur' }))
      .toEqual({ action: 'ignore', reason: 'currency_mismatch' });
  });

  it('is a no-op for non-pending registrations or unpaid sessions', () => {
    expect(evaluateEntryFeeSession({ ...reg, paymentStatus: 'waived' }, session)).toEqual({ action: 'noop' });
    expect(evaluateEntryFeeSession(reg, { ...session, payment_status: 'unpaid' })).toEqual({ action: 'noop' });
  });
});

describe('stripeWebhookHandler entry_fee', () => {
  let registration: { id: string; paymentStatus: string; paymentIntentId: string | null; paymentAmountCents: number | null } | null;
  let tx: {
    billingWebhookEvent: { create: ReturnType<typeof vi.fn> };
    registration: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_entry_fee');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    vi.stubEnv('STRIPE_STARTER_PRICE_ID', 'price_starter_test');
    registration = { id: 'reg-1', paymentStatus: 'pending', paymentIntentId: 'cs_1', paymentAmountCents: 2500 };
    tx = {
      billingWebhookEvent: { create: vi.fn().mockResolvedValue({}) },
      registration: {
        findUnique: vi.fn(async () => registration),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    app = express();
    app.locals.prisma = {
      billingWebhookEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function send(sessionOverrides: Record<string, unknown>) {
    const payload = JSON.stringify({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 2500,
          currency: 'usd',
          metadata: { registrationId: 'reg-1', type: 'entry_fee' },
          ...sessionOverrides,
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  it('marks a matching session paid', async () => {
    const res = await send({});
    expect(res.status).toBe(200);
    expect(tx.registration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'reg-1' },
      data: expect.objectContaining({ paymentStatus: 'paid', paymentAmountCents: 2500 }),
    }));
  });

  it('acknowledges (200) and records an event for an unknown registration instead of throwing', async () => {
    registration = null;
    const res = await send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ processed: false, ignored: true, reason: 'unknown_registration' });
    expect(tx.billingWebhookEvent.create).toHaveBeenCalledOnce();
    expect(tx.registration.update).not.toHaveBeenCalled();
  });

  it('marks paid when the parent pays an older session than the one last stored', async () => {
    registration = { ...registration!, paymentIntentId: 'cs_newer' };
    const res = await send({ id: 'cs_older' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ processed: true, paid: true });
    expect(tx.registration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'reg-1' },
      data: expect.objectContaining({ paymentStatus: 'paid', paymentAmountCents: 2500, paymentIntentId: 'cs_older' }),
    }));
  });

  it('still rejects an older session whose amount does not match the expected fee', async () => {
    registration = { ...registration!, paymentIntentId: 'cs_newer' };
    const res = await send({ id: 'cs_older', amount_total: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('amount_mismatch');
    expect(tx.registration.update).not.toHaveBeenCalled();
  });

  it('does not mark paid when the currency differs', async () => {
    const res = await send({ currency: 'eur' });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('currency_mismatch');
    expect(tx.registration.update).not.toHaveBeenCalled();
  });

  it('does not re-mark an already paid registration', async () => {
    registration = { ...registration!, paymentStatus: 'paid' };
    const res = await send({ id: 'cs_older' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ processed: true, paid: false });
    expect(tx.registration.update).not.toHaveBeenCalled();
  });

  it('does not mark paid when the charged amount differs from the expected fee', async () => {
    const res = await send({ amount_total: 100 });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('amount_mismatch');
    expect(tx.registration.update).not.toHaveBeenCalled();
  });
});

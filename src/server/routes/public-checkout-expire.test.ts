/**
 * /api/public/checkout must best-effort expire a registration's previous
 * open Checkout session before creating a new one, so a parent cannot pay
 * twice from an older tab. Errors from expire (already completed/expired)
 * must not block the new session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const stripeMock = vi.hoisted(() => ({
  expire: vi.fn(),
  create: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { expire: stripeMock.expire, create: stripeMock.create } };
  },
}));

const { default: publicRouter } = await import('./public.js');
const { expireCheckoutSessionBestEffort } = await import('../services/stripe-billing.js');

const TOKEN = 'a'.repeat(43);

describe('POST /api/public/checkout expires the previous session', () => {
  let registration: Record<string, unknown>;
  let update: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_checkout');
    vi.stubEnv('RATE_LIMIT_DISABLED', '1');
    stripeMock.expire.mockReset().mockResolvedValue({});
    stripeMock.create.mockReset().mockResolvedValue({ id: 'cs_new', url: 'https://checkout.test/cs_new' });
    registration = {
      id: '11111111-1111-4111-8111-111111111111',
      paymentStatus: 'pending',
      paymentIntentId: 'cs_old',
      managementTokenExpiresAt: null,
      managementTokenRevokedAt: null,
      tournament: { id: 't-1', name: 'Open', settings: JSON.stringify({ tournamentFeeCents: 2500 }), deletedAt: null },
    };
    update = vi.fn().mockResolvedValue({});
    app = express();
    app.use(express.json());
    app.locals.prisma = { registration: { findUnique: vi.fn(async () => registration), update } };
    app.use('/api/public', publicRouter);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('expires the old session and stores the new one', async () => {
    const res = await request(app).post('/api/public/checkout').send({ managementToken: TOKEN });
    expect(res.status).toBe(201);
    expect(stripeMock.expire).toHaveBeenCalledWith('cs_old');
    expect(stripeMock.create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentIntentId: 'cs_new', paymentAmountCents: 2500 }),
    }));
  });

  it('still creates a new session when the old one can no longer be expired', async () => {
    stripeMock.expire.mockRejectedValue(new Error('Only Checkout Sessions with a status of open can be expired.'));
    const res = await request(app).post('/api/public/checkout').send({ managementToken: TOKEN });
    expect(res.status).toBe(201);
    expect(stripeMock.create).toHaveBeenCalledOnce();
  });

  it('does not call expire when there is no previous session', async () => {
    registration.paymentIntentId = null;
    const res = await request(app).post('/api/public/checkout').send({ managementToken: TOKEN });
    expect(res.status).toBe(201);
    expect(stripeMock.expire).not.toHaveBeenCalled();
  });
});

describe('expireCheckoutSessionBestEffort', () => {
  it('skips ids that are not Checkout sessions', async () => {
    const expire = vi.fn();
    expect(await expireCheckoutSessionBestEffort({ checkout: { sessions: { expire } } }, 'pi_123')).toBe(false);
    expect(await expireCheckoutSessionBestEffort({ checkout: { sessions: { expire } } }, null)).toBe(false);
    expect(expire).not.toHaveBeenCalled();
  });
});

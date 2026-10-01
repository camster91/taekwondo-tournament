/**
 * Self-withdrawal (DELETE /api/public/registrations/:token) must not lose
 * money: a paid registration is refused (the organizer handles refunds),
 * and an open Checkout session is expired so it cannot be paid after the
 * registration is deleted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const stripeMock = vi.hoisted(() => ({ expire: vi.fn(), retrieve: vi.fn() }));

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { expire: stripeMock.expire, retrieve: stripeMock.retrieve } };
  },
}));

const { default: publicRouter } = await import('./public.js');

const TOKEN = 'c'.repeat(43);

describe('DELETE /api/public/registrations/:token and payments', () => {
  let registration: Record<string, unknown>;
  let deleteRegistration: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_withdraw');
    vi.stubEnv('RATE_LIMIT_DISABLED', '1');
    stripeMock.expire.mockReset().mockResolvedValue({});
    stripeMock.retrieve.mockReset().mockResolvedValue({ status: 'open', payment_status: 'unpaid' });
    registration = {
      id: '11111111-1111-4111-8111-111111111111',
      tournamentId: 't-1',
      checkedIn: false,
      paymentStatus: 'pending',
      paymentIntentId: 'cs_open',
      managementTokenExpiresAt: null,
      managementTokenRevokedAt: null,
      tournament: { status: 'draft' },
    };
    deleteRegistration = vi.fn().mockResolvedValue({});
    const tx = {
      divisionAssignment: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
      registration: { delete: deleteRegistration },
    };
    app = express();
    app.use(express.json());
    app.locals.prisma = {
      registration: { findFirst: vi.fn(async () => registration) },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    app.use('/api/public', publicRouter);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses to withdraw a paid registration and keeps the payment record', async () => {
    registration.paymentStatus = 'paid';
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAID_REGISTRATION');
    expect(res.body.error).toMatch(/contact the tournament organizer/i);
    expect(deleteRegistration).not.toHaveBeenCalled();
  });

  it('expires the open Checkout session before deleting an unpaid registration', async () => {
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(stripeMock.expire).toHaveBeenCalledWith('cs_open');
    expect(deleteRegistration).toHaveBeenCalledOnce();
  });

  it('treats a session that completed just before withdrawal as paid', async () => {
    stripeMock.expire.mockRejectedValue(new Error('Only Checkout Sessions with a status of open can be expired.'));
    stripeMock.retrieve.mockResolvedValue({ status: 'complete', payment_status: 'paid' });
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAID_REGISTRATION');
    expect(deleteRegistration).not.toHaveBeenCalled();
  });

  it('still withdraws when the session already expired', async () => {
    stripeMock.expire.mockRejectedValue(new Error('Only Checkout Sessions with a status of open can be expired.'));
    stripeMock.retrieve.mockResolvedValue({ status: 'expired', payment_status: 'unpaid' });
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(deleteRegistration).toHaveBeenCalledOnce();
  });
});

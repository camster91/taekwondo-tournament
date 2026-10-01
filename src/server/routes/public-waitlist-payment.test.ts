/**
 * A waitlisted registrant holds no spot, so they must not be charged:
 * no pending payment, no Checkout session, and /checkout refuses them.
 * Promotion makes the entry fee due so the parent can pay via the
 * management link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';

const stripeMock = vi.hoisted(() => ({ expire: vi.fn(), create: vi.fn() }));

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { expire: stripeMock.expire, create: stripeMock.create } };
  },
}));

const { default: publicRouter } = await import('./public.js');
const { createPublicRegistration, promotedRegistrationPaymentData } = await import('../services/public-registration.js');
const { promoteNextWaitlisted } = await import('../services/waitlist.js');
const { waitlistPromotionEmail } = await import('../services/email-templates.js');

const TOKEN = 'b'.repeat(43);
const FEE_SETTINGS = JSON.stringify({ tournamentFeeCents: 2500 });

function fakeRegistrationDb(capacity: { maxCapacity: number | null; activeCount: number }) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 't-1', maxCapacity: capacity.maxCapacity, waitlistEnabled: true }]),
    registration: {
      count: vi.fn(async () => capacity.activeCount),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          id: '22222222-2222-4222-8222-222222222222',
          tournamentId: 't-1',
          patterns: true,
          sparring: false,
          waitlistStatus: data.waitlistStatus,
          waitlistPosition: data.waitlistPosition,
          paymentStatus: data.paymentStatus,
          paymentAmountCents: data.paymentAmountCents,
        };
      }),
    },
    competitor: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'c-1', firstName: 'Kim', lastName: 'Lee' })),
    },
  };
  const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { prisma: prisma as unknown as PrismaClient, created };
}

const registrationInput = {
  tournamentId: 't-1',
  organizationId: null,
  plan: 'pro',
  competitor: {
    firstName: 'Kim', lastName: 'Lee', gender: 'F', dateOfBirth: new Date('2012-01-01'), belt: 'Yellow',
    danRank: null, heightInches: null, weightLbs: null, schoolDojang: null, specialNeeds: null,
  },
  registration: {
    patterns: true,
    sparring: false,
    ageAtTournament: 14,
    paymentStatus: 'pending',
    paymentAmountCents: 2500,
  },
};

describe('waitlisted registrations owe nothing', () => {
  it('stores a waitlisted registration as not_required with no amount', async () => {
    const { prisma, created } = fakeRegistrationDb({ maxCapacity: 1, activeCount: 1 });
    const result = await createPublicRegistration(prisma, registrationInput);
    expect(result.registration.waitlistStatus).toBe('waitlisted');
    expect(created[0]).toMatchObject({ paymentStatus: 'not_required', paymentAmountCents: null });
  });

  it('keeps the fee pending for a registration that got a spot', async () => {
    const { prisma, created } = fakeRegistrationDb({ maxCapacity: 5, activeCount: 1 });
    await createPublicRegistration(prisma, registrationInput);
    expect(created[0]).toMatchObject({ waitlistStatus: 'active', paymentStatus: 'pending', paymentAmountCents: 2500 });
  });

  it('makes the fee due on promotion only when the tournament charges one', () => {
    expect(promotedRegistrationPaymentData(FEE_SETTINGS, 'not_required')).toEqual({ paymentStatus: 'pending', paymentAmountCents: 2500 });
    expect(promotedRegistrationPaymentData(FEE_SETTINGS, null)).toEqual({ paymentStatus: 'pending', paymentAmountCents: 2500 });
    expect(promotedRegistrationPaymentData(FEE_SETTINGS, 'waived')).toEqual({});
    expect(promotedRegistrationPaymentData(FEE_SETTINGS, 'paid')).toEqual({});
    expect(promotedRegistrationPaymentData(null, 'not_required')).toEqual({});
  });

  it('automatic promotion (after a withdrawal) sets the fee pending', async () => {
    const update = vi.fn(async () => ({}));
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: 't-1', maxCapacity: 2, waitlistEnabled: true }]),
      registration: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({
          id: 'r-9',
          paymentStatus: 'not_required',
          paymentAmountCents: null,
          parentEmail: null,
          competitor: { firstName: 'Kim', lastName: 'Lee' },
          tournament: { settings: FEE_SETTINGS, name: 'Open', date: new Date('2027-01-01'), brandName: null, organization: null },
        })),
        findMany: vi.fn(async () => []),
        update,
      },
    };
    const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) } as unknown as PrismaClient;
    await expect(promoteNextWaitlisted(prisma, 't-1')).resolves.toMatchObject({
      promotedRegistrationId: 'r-9',
      promotion: { registrationId: 'r-9', paymentDueCents: 2500 },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ waitlistStatus: 'promoted', paymentStatus: 'pending', paymentAmountCents: 2500 }),
    }));
  });

  it('the promotion email asks for payment through the management link when a fee is due', () => {
    const base = {
      competitorName: 'Kim Lee', tournamentName: 'Open', tournamentDate: new Date('2027-01-01'),
      confirmationCode: 'abcd1234', managementUrl: 'https://app.test/manage-registration?token=x',
    };
    const due = waitlistPromotionEmail({ ...base, paymentDueCents: 2500 }).html;
    expect(due).toContain('$25.00');
    expect(due).toContain('Complete Payment');
    expect(due).not.toContain('No further action is required');
    expect(waitlistPromotionEmail(base).html).toContain('No further action is required');
  });
});

describe('POST /api/public/checkout for a waitlisted registration', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_checkout');
    vi.stubEnv('RATE_LIMIT_DISABLED', '1');
    stripeMock.create.mockReset().mockResolvedValue({ id: 'cs_new', url: 'https://checkout.test/cs_new' });
    const registration = {
      id: '11111111-1111-4111-8111-111111111111',
      paymentStatus: 'pending', // legacy row created before the fix
      paymentIntentId: null,
      waitlistStatus: 'waitlisted',
      managementTokenExpiresAt: null,
      managementTokenRevokedAt: null,
      tournament: { id: 't-1', name: 'Open', settings: FEE_SETTINGS, deletedAt: null },
    };
    app = express();
    app.use(express.json());
    app.locals.prisma = { registration: { findUnique: vi.fn(async () => registration), update: vi.fn() } };
    app.use('/api/public', publicRouter);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses with 409 and creates no Checkout session', async () => {
    const res = await request(app).post('/api/public/checkout').send({ managementToken: TOKEN });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WAITLISTED');
    expect(stripeMock.create).not.toHaveBeenCalled();
  });
});

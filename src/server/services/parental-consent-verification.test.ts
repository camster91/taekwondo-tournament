import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import {
  createParentalConsentVerification,
  isParentalConsentPending,
  verifyParentalConsent,
} from './parental-consent-verification.js';
import { hashSecret } from '../utils/token-hash.js';

function verificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v-1',
    registrationId: 'r-1',
    verifiedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    registration: {
      id: 'r-1',
      competitor: { firstName: 'Kim', lastName: 'Lee' },
      tournament: { name: 'Open' },
    },
    ...overrides,
  };
}

function fakePrisma(row: unknown) {
  const findUnique = vi.fn(async () => row);
  const create = vi.fn(async () => ({}));
  const prisma = {
    parentalConsentVerification: { findUnique, create, update: vi.fn(() => 'update-consent') },
    registration: { update: vi.fn(() => 'update-registration') },
    $transaction: vi.fn(async () => []),
  };
  return { prisma: prisma as unknown as PrismaClient, findUnique, create, raw: prisma };
}

describe('parental consent tokens', () => {
  it('stores only the token digest and issues no manual-entry code', async () => {
    const { prisma, create } = fakePrisma(null);
    const result = await createParentalConsentVerification(prisma, 'r-1', 'parent@example.com');
    expect(result).toEqual({ token: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(result).not.toHaveProperty('code');
    const data = (create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.token).toBe(hashSecret(result.token));
    expect(data.token).not.toBe(result.token);
    expect(data.code).toBe('');
  });

  it('verifies by digest and marks the registration verified', async () => {
    const token = 'a'.repeat(64);
    const { prisma, findUnique, raw } = fakePrisma(verificationRow());
    const result = await verifyParentalConsent(prisma, token);
    expect(result).toMatchObject({ ok: true, registration: { competitorName: 'Kim Lee', tournamentName: 'Open' } });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { token: hashSecret(token) } }));
    expect(raw.registration.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parentEmailVerified: true }),
    }));
  });

  it('rejects malformed tokens without a lookup, and expired links', async () => {
    const malformed = fakePrisma(verificationRow());
    expect(await verifyParentalConsent(malformed.prisma, 'not-a-token')).toMatchObject({ ok: false });
    expect(malformed.findUnique).not.toHaveBeenCalled();

    const expired = fakePrisma(verificationRow({ expiresAt: new Date(Date.now() - 1) }));
    expect(await verifyParentalConsent(expired.prisma, 'b'.repeat(64))).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it('flags only requested-but-unconfirmed consent', () => {
    expect(isParentalConsentPending({ parentEmailVerified: false, parentalConsentVerification: { verifiedAt: null } })).toBe(true);
    expect(isParentalConsentPending({ parentEmailVerified: true, parentalConsentVerification: { verifiedAt: new Date() } })).toBe(false);
    // Staff-entered registrations never get a consent request.
    expect(isParentalConsentPending({ parentEmailVerified: false, parentalConsentVerification: null })).toBe(false);
  });
});

describe('/api/public/verify-parent-consent', () => {
  async function buildApp(row: unknown) {
    process.env.RATE_LIMIT_DISABLED = '1';
    const { default: publicRouter } = await import('../routes/public.js');
    const fake = fakePrisma(row);
    const app = express();
    app.use(express.json());
    app.locals.prisma = fake.prisma;
    app.use('/api/public', publicRouter);
    return { app, fake };
  }

  it('a GET (link scanner / preview) cannot record consent', async () => {
    const { app, fake } = await buildApp(verificationRow());
    const res = await request(app).get(`/api/public/verify-parent-consent?token=${'a'.repeat(64)}`);
    expect(res.status).toBe(404);
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
  });

  it('records consent on an explicit POST', async () => {
    const { app, fake } = await buildApp(verificationRow());
    const res = await request(app).post('/api/public/verify-parent-consent').send({ token: 'a'.repeat(64) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fake.raw.$transaction).toHaveBeenCalledOnce();
  });
});

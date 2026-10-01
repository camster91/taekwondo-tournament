/**
 * Public registration must write numbers, never raw request strings, into
 * Competitor.danRank (Int) / heightInches / weightLbs (Float). A form that
 * sent danRank: "2" used to reach Prisma as a string and fail with a 500.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const captured = vi.hoisted(() => ({ input: null as any }));

vi.mock('../services/public-registration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/public-registration.js')>();
  return {
    ...actual,
    createPublicRegistration: vi.fn(async (_prisma: unknown, input: unknown) => {
      captured.input = input;
      // Stop the handler right after the write input is built.
      throw new actual.AlreadyRegisteredError();
    }),
  };
});

import publicRouter from './public.js';
import publicPortalRouter from './public-portal.js';

const tournament = {
  id: 'event-1',
  name: 'Spring Championship',
  date: new Date('2027-06-01'),
  location: 'Gym',
  status: 'registration',
  settings: null,
  brandName: null,
  deletedAt: null,
  organizationId: 'org-1',
  organization: { plan: 'pro' },
};

const baseBody = {
  firstName: 'Kim',
  lastName: 'Lee',
  gender: 'F',
  dateOfBirth: '2000-01-01',
  belt: 'Black',
  patterns: true,
  sparring: true,
  privacyAccepted: true,
  rulesAccepted: true,
};

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    tournament: { findUnique: vi.fn().mockResolvedValue(tournament) },
    organization: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-1',
        plan: 'pro',
        brandName: 'Org',
        name: 'Org',
        tournaments: [tournament],
      }),
    },
  };
  app.use('/api/public/portal', publicPortalRouter);
  app.use('/api/public', publicRouter);
  return app;
}

const routes = [
  { name: 'POST /api/public/register', path: '/api/public/register', extra: { tournamentId: 'event-1' } },
  { name: 'POST /api/public/portal/:org/:event/register', path: '/api/public/portal/karate-dojo/spring-2027/register', extra: {} },
];

describe.each(routes)('$name numeric fields', ({ path, extra }) => {
  let app: Express;

  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = '1';
    captured.input = null;
    app = makeApp();
  });

  it('coerces string dan rank, height and weight to numbers', async () => {
    const res = await request(app)
      .post(path)
      .send({ ...baseBody, ...extra, danRank: '3', heightInches: '65.5', weightLbs: '120' });

    expect(res.status).toBe(409);
    expect(captured.input.competitor).toMatchObject({ danRank: 3, heightInches: 65.5, weightLbs: 120 });
    expect(captured.input.registration.weightAtRegistration).toBe(120);
  });

  it('accepts numeric values and defaults a missing black-belt dan rank to 1', async () => {
    const res = await request(app)
      .post(path)
      .send({ ...baseBody, ...extra, danRank: null, heightInches: '', weightLbs: 120 });

    expect(res.status).toBe(409);
    expect(captured.input.competitor).toMatchObject({ danRank: 1, heightInches: null, weightLbs: 120 });
  });

  it.each([
    [{ danRank: '2.5' }, /Dan rank/],
    [{ danRank: 'two' }, /Dan rank/],
    [{ danRank: 11 }, /Dan rank/],
    [{ danRank: 0 }, /Dan rank/],
    [{ heightInches: 'tall' }, /Height/],
    [{ weightLbs: 'heavy' }, /Weight must be a number/],
    [{ weightLbs: { lbs: 1 } }, /Weight must be a number/],
  ])('rejects %j with 400', async (fields, message) => {
    const res = await request(app)
      .post(path)
      .send({ ...baseBody, ...extra, weightLbs: 120, ...fields });

    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(message);
    expect(captured.input).toBeNull();
  });
});

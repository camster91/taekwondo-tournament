/**
 * SH-5: Public registration atomicity + Stripe failure rollback.
 *
 * Closes two production-blocking defects on the public competitor
 * registration flow:
 *
 *   (a) TOCTOU + non-atomic — the previous findFirst + create pair
 *       on Competitor was racy. A same-second double-submit could
 *       both miss the findFirst, then both inserts succeeded and
 *       the auto-categorization engine put the same person in two
 *       divisions. The @@unique([firstName, lastName, dateOfBirth])
 *       on Competitor (migration 20260910_competitor_unique_sh5)
 *       is the source of truth. The route catches P2002 and returns
 *       409 with a clear message.
 *
 *   (b) Stripe failure leaves user stranded — when the Stripe
 *       checkout step threw, the registration was left at
 *       paymentStatus='pending' with no paymentIntentId. The user
 *       had no recovery path. The route now marks the registration
 *       as paymentStatus='failed' and returns 502.
 *
 * Tests mount the real route handlers with a mocked Prisma client
 * and a mocked Stripe. The Prisma mock lets us inject the exact
 * P2002 (PrismaClientKnownRequestError) that the unique constraint
 * produces, so the test exercises the production error-handling
 * branch without needing a live database.
 *
 * Note: the registration handler is mounted at the
 * portal-scoped route `POST /:orgSlug/:eventSlug/register`. The
 * tests use an adult DOB (so guardian attestation is not required)
 * unless a test specifically wants to exercise the minor path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import express, { type Express } from 'express';
import request from 'supertest';

import publicPortalRouter from './public-portal.js';

// ---------------------------------------------------------------------------
// Mocks for the modules loaded transitively by public-portal.ts
// ---------------------------------------------------------------------------

// The waitlist service does a count + lookup against the registration table.
// We don't care about waitlist logic in SH-5 — return deterministic values
// so the registration flow runs to completion.
vi.mock('../services/waitlist.js', () => ({
  checkWaitlistStatus: vi.fn().mockResolvedValue({ shouldWaitlist: false, position: null }),
  getTournamentCapacityStatus: vi.fn().mockResolvedValue({ remaining: 100, total: 100 }),
}));

// parental-consent-verification is only used when a minor is registered.
// Our happy-path tests register an adult so this stays unused.
vi.mock('../services/parental-consent-verification.js', () => ({
  createParentalConsentVerification: vi.fn().mockResolvedValue({ token: 'pct-test', code: '000000' }),
}));

vi.mock('../services/email-templates.js', () => ({
  escapeHtml: (s: string) => s,
  registrationConfirmationEmail: vi.fn().mockReturnValue({ subject: 's', html: '<p>h</p>' }),
  waitlistNotificationEmail: vi.fn().mockReturnValue({ subject: 's', html: '<p>h</p>' }),
  parentalConsentVerificationEmail: vi.fn().mockReturnValue({ subject: 's', html: '<p>h</p>' }),
}));

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mock' }),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

// Build a P2002 PrismaClientKnownRequestError. This is the exact error
// shape the Postgres unique-index violation produces — the route handler
// checks `code === 'P2002'` to identify the race.
function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    '\nUnique constraint failed on the fields: (`firstName`,`lastName`,`dateOfBirth`)',
    { code: 'P2002', clientVersion: '7.9.1', meta: { target: ['firstName', 'lastName', 'dateOfBirth'] } },
  );
}

// Stripe is dynamically imported inside the route. Mock the module so we
// can control whether sessions.create resolves with a URL or throws.
const stripeState = vi.hoisted(() => ({
  createImpl: (() => Promise.resolve({ id: 'cs_test_123', url: 'https://stripe.test/cs_test_123' })) as
    () => Promise<{ id: string; url: string }>,
}));

vi.mock('stripe', () => {
  // The route does `const Stripe = (await import('stripe')).default;`
  // — i.e. it imports the module's `default` export, then calls
  // `new Stripe(key)`. The constructor must return an object with
  // `checkout.sessions.create`.
  const StripeCtor: any = function (_key: string) {
    return {
      checkout: {
        sessions: { create: stripeState.createImpl },
      },
    };
  };
  return { default: StripeCtor };
});

function createMockPrisma(): Partial<PrismaClient> {
  return {
    organization: {
      findUnique: vi.fn(),
    } as any,
    registration: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    } as any,
    competitor: {
      findFirst: vi.fn(),
      create: vi.fn(),
    } as any,
  };
}

function setActiveEvent(prisma: Partial<PrismaClient>, overrides: Record<string, unknown> = {}) {
  (prisma.organization!.findUnique as any).mockResolvedValue({
    id: 'org-1',
    plan: 'pro',
    brandName: 'Test Org',
    name: 'Test Org',
    tournaments: [{
      id: 'event-1',
      name: 'Spring Championship',
      date: new Date('2027-06-01'),
      location: 'Test Venue',
      status: 'registration',
      settings: null,
      brandName: null,
      organizationId: 'org-1',
      ...overrides,
    }],
  });
  (prisma.registration!.count as any).mockResolvedValue(0);
}

// Adult competitor — born 1995, ~32 at the 2027-06-01 tournament.
// No guardian attestation required.
const ADULT_DOB = '1995-05-12';
const ADULT_BODY = {
  firstName: 'Minho',
  lastName: 'Kim',
  gender: 'M',
  dateOfBirth: ADULT_DOB,
  belt: 'Yellow',
  patterns: true,
  privacyAccepted: true,
  rulesAccepted: true,
};

describe('SH-5: public registration atomicity (POST /api/public/portal/:orgSlug/:eventSlug/register)', () => {
  let app: Express;
  let prisma: Partial<PrismaClient>;

  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = '1';
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_SECRET_KEY = ''; // Disable Stripe by default

    app = express();
    app.use(express.json());
    prisma = createMockPrisma();
    app.locals.prisma = prisma;
    app.use('/api/public/portal', publicPortalRouter);

    vi.clearAllMocks();
    setActiveEvent(prisma);
  });

  // ---------------------------------------------------------------------
  // (a) TOCTOU race: P2002 on Competitor must surface as 409.
  // ---------------------------------------------------------------------

  describe('competitor uniqueness invariant (SH-5a)', () => {
    it('returns 409 with a clear message when competitor create hits the unique constraint', async () => {
      // The findFirst returns no match (the user has not registered
      // before) — this is the case the original TOCTOU bug was
      // produced by. The create then races against a concurrent
      // insert and P2002 fires.
      (prisma.competitor!.findFirst as any).mockResolvedValue(null);
      (prisma.competitor!.create as any).mockRejectedValue(makeP2002());

      const response = await request(app)
        .post('/api/public/portal/karate-dojo/spring-2027/register')
        .send(ADULT_BODY);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Already registered');
      expect(response.body.message).toMatch(/already registered/i);
      // The registration must NOT be created — the duplicate
      // competitor insert is the entire point of the failure.
      expect(prisma.registration!.create).not.toHaveBeenCalled();
    });

    it('re-throws non-P2002 Prisma errors so the global handler returns 500 (not 409)', async () => {
      // Defense in depth: the catch should only swallow P2002. A
      // generic Prisma error (e.g. connection failure) must
      // propagate so the global error handler returns 500.
      // Critically, this is NOT 409, so the user sees a generic
      // error state rather than a misleading "already registered"
      // message.
      (prisma.competitor!.findFirst as any).mockResolvedValue(null);
      const genericError = new Prisma.PrismaClientKnownRequestError('connection lost', {
        code: 'P1001',
        clientVersion: '7.9.1',
      });
      (prisma.competitor!.create as any).mockRejectedValue(genericError);

      const response = await request(app)
        .post('/api/public/portal/karate-dojo/spring-2027/register')
        .send(ADULT_BODY);

      expect(response.status).toBe(500);
      expect(response.body.error).not.toBe('Already registered');
    });

    it('still reuses an existing competitor when the findFirst hits (no P2002 path)', async () => {
      // Sanity check that the happy path still works: if a
      // competitor is found, the route does NOT call create.
      const existing = {
        id: 'cmp-1',
        firstName: 'Minho',
        lastName: 'Kim',
        dateOfBirth: new Date(ADULT_DOB),
      };
      (prisma.competitor!.findFirst as any).mockResolvedValue(existing);
      (prisma.registration!.findUnique as any).mockResolvedValue(null);
      (prisma.registration!.create as any).mockResolvedValue({
        id: 'reg-1',
        patterns: true,
        sparring: false,
        weightAtRegistration: null,
        waitlistStatus: 'active',
        waitlistPosition: null,
        paymentStatus: 'not_required',
        paymentAmountCents: null,
        competitor: existing,
        tournament: { name: 'Spring Championship', date: new Date('2027-06-01'), location: 'Test Venue' },
      });

      const response = await request(app)
        .post('/api/public/portal/karate-dojo/spring-2027/register')
        .send(ADULT_BODY);

      expect(response.status).toBe(201);
      expect(prisma.competitor!.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // (b) Stripe failure: registration must not be left at `pending`.
  // ---------------------------------------------------------------------

  describe('Stripe failure rollback (SH-5b)', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
      // Fee-bearing event: requires Stripe checkout
      setActiveEvent(prisma, {
        settings: JSON.stringify({ tournamentFeeCents: 2500 }),
      });
      // Competitor doesn't exist yet — will be created
      (prisma.competitor!.findFirst as any).mockResolvedValue(null);
      (prisma.competitor!.create as any).mockResolvedValue({
        id: 'cmp-1',
        firstName: 'Minho',
        lastName: 'Kim',
      });
      (prisma.registration!.findUnique as any).mockResolvedValue(null);
    });

    it('marks the registration as paymentStatus=failed (not pending) when Stripe checkout throws', async () => {
      (prisma.registration!.create as any).mockResolvedValue({
        id: 'reg-1',
        patterns: true,
        sparring: false,
        weightAtRegistration: null,
        waitlistStatus: 'active',
        waitlistPosition: null,
        paymentStatus: 'pending',
        paymentAmountCents: 2500,
        competitor: { firstName: 'Minho', lastName: 'Kim' },
        tournament: { name: 'Spring Championship', date: new Date('2027-06-01'), location: 'Test Venue' },
      });
      // Stripe throws — e.g. API outage, auth failure, rate limit
      stripeState.createImpl = () => Promise.reject(new Error('Stripe API down'));

      const response = await request(app)
        .post('/api/public/portal/karate-dojo/spring-2027/register')
        .send(ADULT_BODY);

      // The user MUST be told the registration did not complete
      // payment — 502, not a 201 silent success.
      expect(response.status).toBe(502);
      expect(response.body.error).toMatch(/Payment system unavailable/i);
      expect(response.body.paymentStatus).toBe('failed');
      // The registration row must be marked failed so staff can
      // see it in the registration list and manually mark paid/waived.
      expect(prisma.registration!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reg-1' },
          data: { paymentStatus: 'failed' },
        }),
      );
    });

    it('returns 201 with checkoutUrl when Stripe succeeds (regression: happy path still works)', async () => {
      (prisma.registration!.create as any).mockResolvedValue({
        id: 'reg-1',
        patterns: true,
        sparring: false,
        weightAtRegistration: null,
        waitlistStatus: 'active',
        waitlistPosition: null,
        paymentStatus: 'pending',
        paymentAmountCents: 2500,
        competitor: { firstName: 'Minho', lastName: 'Kim' },
        tournament: { name: 'Spring Championship', date: new Date('2027-06-01'), location: 'Test Venue' },
      });
      (prisma.registration!.update as any).mockResolvedValue({});
      stripeState.createImpl = () => Promise.resolve({ id: 'cs_test_abc', url: 'https://stripe.test/cs_test_abc' });

      const response = await request(app)
        .post('/api/public/portal/karate-dojo/spring-2027/register')
        .send(ADULT_BODY);

      expect(response.status).toBe(201);
      expect(response.body.checkoutUrl).toBe('https://stripe.test/cs_test_abc');
      // The success path updates paymentIntentId, not paymentStatus
      expect(prisma.registration!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reg-1' },
          data: { paymentIntentId: 'cs_test_abc' },
        }),
      );
      // Critically, the failure-rollback update (paymentStatus=failed) must NOT have run
      const updateCalls = vi.mocked(prisma.registration!.update as any).mock.calls;
      const markedFailed = updateCalls.some((call) => call[0]?.data?.paymentStatus === 'failed');
      expect(markedFailed).toBe(false);
    });
  });
});

/**
 * DB-backed regression tests for anonymous registration hardening:
 * - competitor re-use is tenant-scoped and never mutates/exposes a shared record
 * - capacity, waitlist and plan limits hold under concurrent submissions
 * - withdraw promotes from the waitlist without failing the withdrawal
 * - portal-issued management tokens expire
 * - /checkout requires the management token and a payable state
 *
 * Skipped when no migrated Postgres is reachable (see contracts/db-probe.ts).
 * Run locally with e.g. DATABASE_URL=postgresql://postgres:pg@localhost:5432/mig
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import publicRouter from './public.js';
import publicPortalRouter from './public-portal.js';
import { connectContractDb } from '../contracts/db-probe.js';
import { hashManagementToken } from '../utils/registration-management-token.js';

const prisma = await connectContractDb();
const run = randomUUID().slice(0, 8);

const orgIds: string[] = [];
const tournamentIds: string[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.locals.prisma = prisma;
  app.use('/api/public', publicRouter);
  app.use('/api/public/portal', publicPortalRouter);
  return app;
}

function registrationBody(tournamentId: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) {
  return {
    tournamentId,
    firstName,
    lastName,
    gender: 'M',
    dateOfBirth: '1990-01-01',
    belt: 'Blue',
    patterns: true,
    privacyAccepted: true,
    rulesAccepted: true,
    ...extra,
  };
}

async function createOrg(plan = 'pro') {
  const org = await prisma!.organization.create({
    data: { name: `Reg Test ${run}`, slug: `reg-${run}-${orgIds.length}`, plan },
  });
  orgIds.push(org.id);
  return org;
}

async function createTournament(data: {
  organizationId: string | null;
  maxCapacity?: number | null;
  waitlistEnabled?: boolean;
  settings?: string;
  eventSlug?: string;
}) {
  const t = await prisma!.tournament.create({
    data: {
      name: `Reg Test ${run} ${tournamentIds.length}`,
      date: new Date('2030-06-01'),
      location: 'Test Arena',
      status: 'registration',
      organizationId: data.organizationId,
      maxCapacity: data.maxCapacity ?? null,
      waitlistEnabled: data.waitlistEnabled ?? false,
      settings: data.settings,
      eventSlug: data.eventSlug,
      portalPublished: !!data.eventSlug,
    },
  });
  tournamentIds.push(t.id);
  return t;
}

describe.skipIf(!prisma)('anonymous registration hardening (database)', () => {
  const app = buildApp();

  afterAll(async () => {
    const db = prisma!;
    try {
      const regs = await db.registration.findMany({
        where: { tournamentId: { in: tournamentIds } },
        select: { competitorId: true },
      });
      await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
      const competitorIds = [...new Set(regs.map((r) => r.competitorId))];
      await db.competitor.deleteMany({ where: { id: { in: competitorIds }, registrations: { none: {} } } });
      await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    } finally {
      await db.$disconnect();
    }
  });

  describe('tenant-scoped competitor re-use', () => {
    let orgA: { id: string };
    let orgB: { id: string };
    let tA1: { id: string };
    let tA2: { id: string };
    let foreignCompetitorId: string;
    const lastName = `Shared${run}`;

    beforeAll(async () => {
      orgA = await createOrg();
      orgB = await createOrg();
      tA1 = await createTournament({ organizationId: orgA.id });
      tA2 = await createTournament({ organizationId: orgA.id });
      const tB = await createTournament({ organizationId: orgB.id });
      const foreign = await prisma!.competitor.create({
        data: {
          firstName: 'Casey', lastName, gender: 'F', dateOfBirth: new Date('1990-01-01'),
          belt: 'Red', schoolDojang: 'Org B Private Dojang',
        },
      });
      foreignCompetitorId = foreign.id;
      await prisma!.registration.create({ data: { tournamentId: tB.id, competitorId: foreign.id, patterns: true } });
    });

    let tokenA1: string;
    let tokenA2: string;
    let ownCompetitorId: string;

    it('does not link a registration to another organization’s competitor', async () => {
      const res = await request(app).post('/api/public/register')
        .send(registrationBody(tA1.id, 'CASEY', lastName, { schoolDojang: 'Org A Dojang' }));
      expect(res.status).toBe(201);
      tokenA1 = res.body.registration.managementToken;

      const reg = await prisma!.registration.findFirstOrThrow({ where: { tournamentId: tA1.id } });
      expect(reg.competitorId).not.toBe(foreignCompetitorId);
      ownCompetitorId = reg.competitorId;
    });

    it('lets the token holder read and edit a competitor their registration created', async () => {
      const get = await request(app).get(`/api/public/registrations/${tokenA1}`);
      expect(get.status).toBe(200);
      expect(get.body.registration.school).toBe('Org A Dojang');
      expect(get.body.registration.profileEditable).toBe(true);

      const patch = await request(app).patch(`/api/public/registrations/${tokenA1}`).send({ school: 'Org A Renamed' });
      expect(patch.status).toBe(200);
      const own = await prisma!.competitor.findUniqueOrThrow({ where: { id: ownCompetitorId } });
      expect(own.schoolDojang).toBe('Org A Renamed');

      const foreign = await prisma!.competitor.findUniqueOrThrow({ where: { id: foreignCompetitorId } });
      expect(foreign.schoolDojang).toBe('Org B Private Dojang');
      expect(foreign.firstName).toBe('Casey');
    });

    it('re-uses a same-organization competitor but hides and locks its shared profile', async () => {
      const res = await request(app).post('/api/public/register')
        .send(registrationBody(tA2.id, 'Casey', lastName, { schoolDojang: 'Attacker Dojang' }));
      expect(res.status).toBe(201);
      tokenA2 = res.body.registration.managementToken;
      const reg = await prisma!.registration.findFirstOrThrow({ where: { tournamentId: tA2.id } });
      expect(reg.competitorId).toBe(ownCompetitorId);

      const get = await request(app).get(`/api/public/registrations/${tokenA2}`);
      expect(get.status).toBe(200);
      expect(get.body.registration.school).toBeNull();
      expect(get.body.registration.belt).toBeNull();
      expect(get.body.registration.gender).toBeNull();
      expect(get.body.registration.profileEditable).toBe(false);

      const locked = await request(app).patch(`/api/public/registrations/${tokenA2}`).send({ school: 'Overwritten' });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('COMPETITOR_PROFILE_LOCKED');

      // Registration-scoped edits still work, including the client's
      // echo of hidden (empty) profile fields.
      const ok = await request(app).patch(`/api/public/registrations/${tokenA2}`).send({
        firstName: get.body.registration.firstName, gender: '', belt: '', school: null,
        specialNeeds: 'Needs water breaks', competeWithOlder: true, patterns: true, sparring: false,
      });
      expect(ok.status).toBe(200);
      const own = await prisma!.competitor.findUniqueOrThrow({ where: { id: ownCompetitorId } });
      expect(own.schoolDojang).toBe('Org A Renamed');
      expect(own.specialNeeds).toBeNull();
      const updated = await prisma!.registration.findFirstOrThrow({ where: { tournamentId: tA2.id } });
      expect(updated.specialNeeds).toBe('Needs water breaks');
      expect(updated.competeWithOlder).toBe(true);

      // The first token can no longer edit the now-shared competitor either.
      const firstToken = await request(app).patch(`/api/public/registrations/${tokenA1}`).send({ school: 'Again' });
      expect(firstToken.status).toBe(409);
    });

    it('still rejects a duplicate registration for the same tournament', async () => {
      const res = await request(app).post('/api/public/register').send(registrationBody(tA2.id, 'casey', lastName));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Already registered');
    });
  });

  describe('capacity, waitlist and plan limits under concurrency', () => {
    it('never overbooks a full tournament without a waitlist (409 TOURNAMENT_FULL)', async () => {
      const org = await createOrg();
      const t = await createTournament({ organizationId: org.id, maxCapacity: 3, waitlistEnabled: false });
      const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        request(app).post('/api/public/register').send(registrationBody(t.id, `Cap${i}`, `Full${run}`))));
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.code === 'TOURNAMENT_FULL')).toBe(true);
      expect(await prisma!.registration.count({ where: { tournamentId: t.id } })).toBe(3);
    });

    let waitlistTournamentId: string;
    let waitlistTokens: Array<{ token: string; status: string; position: number | null }>;

    it('assigns unique, dense waitlist positions under concurrent submissions', async () => {
      const org = await createOrg();
      const t = await createTournament({ organizationId: org.id, maxCapacity: 2, waitlistEnabled: true });
      waitlistTournamentId = t.id;
      const responses = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        request(app).post('/api/public/register').send(registrationBody(t.id, `Wait${i}`, `List${run}`))));
      expect(responses.every((r) => r.status === 201)).toBe(true);
      waitlistTokens = responses.map((r) => ({
        token: r.body.registration.managementToken,
        status: r.body.registration.waitlistStatus,
        position: r.body.registration.waitlistPosition,
      }));
      const regs = await prisma!.registration.findMany({ where: { tournamentId: t.id } });
      expect(regs.filter((r) => r.waitlistStatus === 'active')).toHaveLength(2);
      const positions = regs.filter((r) => r.waitlistStatus === 'waitlisted').map((r) => r.waitlistPosition).sort();
      expect(positions).toEqual([1, 2, 3, 4]);
    });

    it('withdrawing an active registration promotes waitlist #1 and renumbers', async () => {
      const active = waitlistTokens.find((t) => t.status === 'active')!;
      const first = await prisma!.registration.findFirstOrThrow({
        where: { tournamentId: waitlistTournamentId, waitlistPosition: 1 },
      });

      const res = await request(app).delete(`/api/public/registrations/${active.token}`);
      expect(res.status).toBe(200);

      const promoted = await prisma!.registration.findUniqueOrThrow({ where: { id: first.id } });
      expect(promoted.waitlistStatus).toBe('promoted');
      expect(promoted.waitlistPosition).toBeNull();
      expect(promoted.waitlistPromotedAt).not.toBeNull();
      const positions = (await prisma!.registration.findMany({
        where: { tournamentId: waitlistTournamentId, waitlistStatus: 'waitlisted' },
      })).map((r) => r.waitlistPosition).sort();
      expect(positions).toEqual([1, 2, 3]);
    });

    it('withdrawing a waitlisted registration renumbers without promoting', async () => {
      const waitlisted = await prisma!.registration.findMany({
        where: { tournamentId: waitlistTournamentId, waitlistStatus: 'waitlisted' },
        orderBy: { waitlistPosition: 'asc' },
      });
      // Withdraw whoever currently holds waitlist position 2.
      const token = waitlistTokens.find((t) => hashManagementToken(t.token) === waitlisted[1].managementTokenHash)!.token;

      const res = await request(app).delete(`/api/public/registrations/${token}`);
      expect(res.status).toBe(200);
      const regs = await prisma!.registration.findMany({ where: { tournamentId: waitlistTournamentId } });
      expect(regs.filter((r) => r.waitlistStatus !== 'waitlisted')).toHaveLength(2);
      expect(regs.filter((r) => r.waitlistStatus === 'waitlisted').map((r) => r.waitlistPosition).sort()).toEqual([1, 2]);
    });

    it('enforces the plan registration limit under concurrency', async () => {
      const org = await createOrg('free'); // 30 competitors per tournament
      const t = await createTournament({ organizationId: org.id });
      const seedCompetitors = await Promise.all(Array.from({ length: 28 }, (_, i) => prisma!.competitor.create({
        data: { firstName: `Seed${i}`, lastName: `Plan${run}`, gender: 'M', dateOfBirth: new Date('1990-01-01'), belt: 'White' },
      })));
      await prisma!.registration.createMany({
        data: seedCompetitors.map((c) => ({ tournamentId: t.id, competitorId: c.id, patterns: true })),
      });

      const responses = await Promise.all(Array.from({ length: 5 }, (_, i) =>
        request(app).post('/api/public/register').send(registrationBody(t.id, `Late${i}`, `Plan${run}`))));
      expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
      expect(responses.filter((r) => r.status === 400)).toHaveLength(3);
      expect(await prisma!.registration.count({ where: { tournamentId: t.id } })).toBe(30);
    });
  });

  describe('portal registration', () => {
    it('issues management tokens with an expiry', async () => {
      const org = await createOrg();
      const slug = `evt-${run}`;
      const t = await createTournament({ organizationId: org.id, eventSlug: slug });
      const orgRow = await prisma!.organization.findUniqueOrThrow({ where: { id: org.id } });

      const res = await request(app).post(`/api/public/portal/${orgRow.slug}/${slug}/register`)
        .send(registrationBody(t.id, 'Portal', `Expiry${run}`));
      expect(res.status).toBe(201);
      const reg = await prisma!.registration.findFirstOrThrow({ where: { tournamentId: t.id } });
      expect(reg.managementTokenExpiresAt).not.toBeNull();
      expect(reg.managementTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    });
  });

  describe('POST /api/public/checkout', () => {
    let token: string;
    let registrationId: string;

    beforeAll(async () => {
      const org = await createOrg();
      const t = await createTournament({ organizationId: org.id });
      const res = await request(app).post('/api/public/register').send(registrationBody(t.id, 'Pay', `Checkout${run}`));
      token = res.body.registration.managementToken;
      registrationId = res.body.registration.id;
    });

    it('rejects a bare registration id', async () => {
      const res = await request(app).post('/api/public/checkout').send({ registrationId });
      expect(res.status).toBe(400);
    });

    it('rejects a token paired with a different registration id', async () => {
      const res = await request(app).post('/api/public/checkout').send({ managementToken: token, registrationId: randomUUID() });
      expect(res.status).toBe(404);
    });

    it('refuses to reopen payment for not_required / waived registrations', async () => {
      const notRequired = await request(app).post('/api/public/checkout').send({ managementToken: token });
      expect(notRequired.status).toBe(409);

      await prisma!.registration.update({ where: { id: registrationId }, data: { paymentStatus: 'waived' } });
      const waived = await request(app).post('/api/public/checkout').send({ managementToken: token });
      expect(waived.status).toBe(409);
      const row = await prisma!.registration.findUniqueOrThrow({ where: { id: registrationId } });
      expect(row.paymentStatus).toBe('waived');
    });

    it('allows pending/failed registrations through to the payment provider', async () => {
      const t = await prisma!.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { tournamentId: true } });
      await prisma!.tournament.update({ where: { id: t.tournamentId }, data: { settings: JSON.stringify({ tournamentFeeCents: 2500 }) } });
      const previousKey = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;
      try {
        for (const status of ['pending', 'failed']) {
          await prisma!.registration.update({ where: { id: registrationId }, data: { paymentStatus: status } });
          const res = await request(app).post('/api/public/checkout').send({ managementToken: token });
          expect(res.status).toBe(503); // passed auth + state checks; Stripe not configured
        }
      } finally {
        if (previousKey !== undefined) process.env.STRIPE_SECRET_KEY = previousKey;
      }
    });

    it('rejects revoked tokens', async () => {
      await prisma!.registration.update({ where: { id: registrationId }, data: { managementTokenRevokedAt: new Date() } });
      const res = await request(app).post('/api/public/checkout').send({ managementToken: token });
      expect(res.status).toBe(404);
    });
  });
});

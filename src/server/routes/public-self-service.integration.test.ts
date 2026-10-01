/**
 * DB-backed tests for parent self-service through the management token
 * (PATCH / DELETE /api/public/registrations/:token):
 * - edits never delete Match rows (they are shared with the opponent and
 *   referenced by Bracket.structure); division assignments are only touched
 *   when a division-relevant field changes, and such changes (and
 *   withdrawal) are refused once a bracket has been drawn.
 * - edits are validated against the merged (stored + patch) registration.
 *
 * Skipped when no migrated Postgres is reachable (see contracts/db-probe.ts).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import publicRouter from './public.js';
import { connectContractDb } from '../contracts/db-probe.js';

process.env.RATE_LIMIT_DISABLED = '1';

const prisma = await connectContractDb();
const run = randomUUID().slice(0, 8);
const tournamentIds: string[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.locals.prisma = prisma;
  app.use('/api/public', publicRouter);
  return app;
}

async function createTournament(settings?: string) {
  const t = await prisma!.tournament.create({
    data: {
      name: `Self Service ${run} ${tournamentIds.length}`,
      date: new Date('2030-06-01'),
      status: 'registration',
      settings,
    },
  });
  tournamentIds.push(t.id);
  return t;
}

async function register(app: express.Express, tournamentId: string, firstName: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/public/register').send({
    tournamentId,
    firstName,
    lastName: `Parent${run}`,
    gender: 'F',
    dateOfBirth: '1990-01-01',
    belt: 'Blue',
    patterns: true,
    privacyAccepted: true,
    rulesAccepted: true,
    ...extra,
  });
  expect(res.status).toBe(201);
  const registration = await prisma!.registration.findUniqueOrThrow({ where: { id: res.body.registration.id } });
  return { token: res.body.registration.managementToken as string, registration };
}

/** Put both registrations in one division; optionally draw its bracket with one match between them. */
async function placeInDivision(tournamentId: string, regIds: string[], withBracket: boolean) {
  const division = await prisma!.division.create({
    data: { tournamentId, name: `Div ${run}`, beltLevel: 'CB', gender: 'F', eventType: 'patterns', ageMin: 18, ageMax: 99 },
  });
  await prisma!.divisionAssignment.createMany({
    data: regIds.map((registrationId, i) => ({ divisionId: division.id, registrationId, seedPosition: i + 1 })),
  });
  let matchId: string | null = null;
  if (withBracket) {
    const bracket = await prisma!.bracket.create({ data: { divisionId: division.id, structure: '{}' } });
    const match = await prisma!.match.create({
      data: {
        bracketId: bracket.id, roundNumber: 1, matchNumber: 1, bracketType: 'winners',
        competitor1Id: regIds[0], competitor2Id: regIds[1], status: 'ready',
      },
    });
    matchId = match.id;
  }
  return { divisionId: division.id, matchId };
}

describe.skipIf(!prisma)('parent self-service edits and withdrawal (database)', () => {
  const app = buildApp();

  afterAll(async () => {
    const db = prisma!;
    try {
      const regs = await db.registration.findMany({
        where: { tournamentId: { in: tournamentIds } },
        select: { competitorId: true },
      });
      await db.match.deleteMany({ where: { bracket: { division: { tournamentId: { in: tournamentIds } } } } });
      await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
      const competitorIds = [...new Set(regs.map((r) => r.competitorId))];
      await db.competitor.deleteMany({ where: { id: { in: competitorIds }, registrations: { none: {} } } });
    } finally {
      await db.$disconnect();
    }
  });

  describe('division assignments and matches', () => {
    it('a special-needs-only edit keeps assignments and the drawn bracket intact', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Ada');
      const b = await register(app, t.id, 'Bea');
      const { matchId } = await placeInDivision(t.id, [a.registration.id, b.registration.id], true);

      const res = await request(app).patch(`/api/public/registrations/${a.token}`).send({ specialNeeds: 'Asthma inhaler' });
      expect(res.status).toBe(200);

      expect(await prisma!.divisionAssignment.count({ where: { registrationId: a.registration.id } })).toBe(1);
      const match = await prisma!.match.findUniqueOrThrow({ where: { id: matchId! } });
      expect(match.competitor1Id).toBe(a.registration.id);
      expect(match.competitor2Id).toBe(b.registration.id);
    });

    it('refuses a division-relevant edit once a bracket is drawn, changing nothing', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Cat');
      const b = await register(app, t.id, 'Dee');
      const { matchId } = await placeInDivision(t.id, [a.registration.id, b.registration.id], true);

      const res = await request(app).patch(`/api/public/registrations/${a.token}`).send({ belt: 'Red' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BRACKET_LOCKED');

      const competitor = await prisma!.competitor.findUniqueOrThrow({ where: { id: a.registration.competitorId } });
      expect(competitor.belt).toBe('Blue');
      expect(await prisma!.divisionAssignment.count({ where: { registrationId: a.registration.id } })).toBe(1);
      expect(await prisma!.match.findUnique({ where: { id: matchId! } })).not.toBeNull();
    });

    it('re-sending unchanged division fields is not treated as a division change', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Eve');
      const b = await register(app, t.id, 'Fay');
      await placeInDivision(t.id, [a.registration.id, b.registration.id], true);

      // The management page always submits every field.
      const res = await request(app).patch(`/api/public/registrations/${a.token}`)
        .send({ firstName: 'Evie', belt: 'Blue', gender: 'F', patterns: true, sparring: false });
      expect(res.status).toBe(200);
      expect(await prisma!.divisionAssignment.count({ where: { registrationId: a.registration.id } })).toBe(1);
    });

    it('drops stale assignments for a division-relevant edit before any bracket exists', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Gia');
      const b = await register(app, t.id, 'Hal');
      await placeInDivision(t.id, [a.registration.id, b.registration.id], false);

      const res = await request(app).patch(`/api/public/registrations/${a.token}`).send({ belt: 'Red' });
      expect(res.status).toBe(200);
      expect(await prisma!.divisionAssignment.count({ where: { registrationId: a.registration.id } })).toBe(0);
      expect(await prisma!.divisionAssignment.count({ where: { registrationId: b.registration.id } })).toBe(1);
    });

    it('refuses withdrawal once a bracket is drawn and keeps the opponent’s match', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Ivy');
      const b = await register(app, t.id, 'Jo');
      const { matchId } = await placeInDivision(t.id, [a.registration.id, b.registration.id], true);

      const res = await request(app).delete(`/api/public/registrations/${a.token}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BRACKET_LOCKED');
      expect(await prisma!.registration.findUnique({ where: { id: a.registration.id } })).not.toBeNull();
      const match = await prisma!.match.findUniqueOrThrow({ where: { id: matchId! } });
      expect(match.competitor1Id).toBe(a.registration.id);
    });

    it('validates the merged registration, not just the patch', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Max');

      const noEvents = await request(app).patch(`/api/public/registrations/${a.token}`).send({ patterns: false });
      expect(noEvents.status).toBe(400);
      expect(noEvents.body.error).toMatch(/at least one event/);

      const noWeight = await request(app).patch(`/api/public/registrations/${a.token}`).send({ sparring: true });
      expect(noWeight.status).toBe(400);
      expect(noWeight.body.error).toMatch(/Weight is required/);

      const stored = await prisma!.registration.findUniqueOrThrow({ where: { id: a.registration.id } });
      expect(stored).toMatchObject({ patterns: true, sparring: false });

      const ok = await request(app).patch(`/api/public/registrations/${a.token}`).send({ sparring: true, weight: 120 });
      expect(ok.status).toBe(200);
    });

    it('accepts the management page payload with weight: null for a registrant without weight', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Ned');
      const res = await request(app).patch(`/api/public/registrations/${a.token}`).send({
        firstName: 'Ned', gender: 'F', belt: 'Blue', school: null, weight: null,
        specialNeeds: 'Glasses', competeWithOlder: false, patterns: true, sparring: false,
      });
      expect(res.status).toBe(200);
    });

    it('withdraws normally before brackets are drawn', async () => {
      const t = await createTournament();
      const a = await register(app, t.id, 'Kai');
      const b = await register(app, t.id, 'Lu');
      await placeInDivision(t.id, [a.registration.id, b.registration.id], false);

      const res = await request(app).delete(`/api/public/registrations/${a.token}`);
      expect(res.status).toBe(200);
      expect(await prisma!.registration.findUnique({ where: { id: a.registration.id } })).toBeNull();
    });
  });
});

/**
 * Public scoreboard contract tests.
 *
 * These tests verify that the Prisma query used by the public scoreboard
 * endpoints matches the documented API contract AND never exposes
 * registration PII. If these tests fail, either:
 *
 * 1. The Prisma query has drifted (update public-scoreboard-query.ts)
 * 2. The contract schema is wrong (update the schema)
 * 3. A migration changed the DB shape (update both)
 *
 * DO NOT disable these tests without team review — they guard the highest-
 * traffic public endpoint, which is unauthenticated and shows minors' data.
 *
 * DB-backed tests are skipped (not failed) when no migrated database is
 * reachable; see db-probe.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {
  validatePublicScoreboardResponse,
  apiDivisionSchema,
} from '../../shared/contracts/index.js';
import {
  PUBLIC_SCOREBOARD_FORBIDDEN_KEYS,
  collectKeys,
  publicScoreboardDivisionArgs,
} from '../routes/public-scoreboard-query.js';
import publicRouter from '../routes/public.js';
import { connectContractDb } from './db-probe.js';

const prisma = await connectContractDb();
const dbAvailable = prisma !== null;

const publicSlug = `ct${randomUUID().replace(/-/g, '').slice(0, 14)}`;
let testTournamentId: string;
let testDivisionId: string;
let testCompetitorIds: string[] = [];

function expectNoPii(payload: unknown) {
  const keys = collectKeys(JSON.parse(JSON.stringify(payload)));
  for (const forbidden of PUBLIC_SCOREBOARD_FORBIDDEN_KEYS) {
    expect(keys.has(forbidden), `public scoreboard payload exposes "${forbidden}"`).toBe(false);
  }
}

describe.skipIf(!dbAvailable)('Public Scoreboard Contract (database)', () => {
  beforeAll(async () => {
    const db = prisma!;
    const tournament = await db.tournament.create({
      data: {
        name: 'Contract Test Tournament',
        date: new Date('2026-12-01'),
        status: 'in_progress',
        location: 'Test Arena',
        publicSlug,
      },
    });
    testTournamentId = tournament.id;

    // Two registrations loaded with every sensitive field populated so a
    // regression to `include` would surface them.
    const registrations = [];
    for (const name of ['Alpha', 'Bravo']) {
      const competitor = await db.competitor.create({
        data: {
          firstName: name,
          lastName: 'Contract',
          gender: 'M',
          dateOfBirth: new Date('2016-05-05'),
          belt: 'Yellow',
          weightLbs: 61,
          heightInches: 50,
          schoolDojang: 'Contract Dojang',
          specialNeeds: 'Asthma inhaler',
        },
      });
      testCompetitorIds.push(competitor.id);
      registrations.push(await db.registration.create({
        data: {
          tournamentId: testTournamentId,
          competitorId: competitor.id,
          sparring: true,
          weightAtRegistration: 61,
          parentName: 'Parent Secret',
          parentEmail: 'parent.secret@example.test',
          parentPhone: '555-0100',
          specialNeeds: 'Registration medical note',
          managementTokenHash: `hash-${randomUUID()}`,
          paymentStatus: 'paid',
          paymentIntentId: 'cs_test_contract',
          paymentAmountCents: 2500,
        },
      }));
    }

    const division = await db.division.create({
      data: {
        tournamentId: testTournamentId,
        name: 'Test Division',
        eventType: 'sparring',
        beltLevel: 'CB',
        gender: 'M',
        ageMin: 8,
        ageMax: 10,
      },
    });
    testDivisionId = division.id;

    await db.bracket.create({
      data: {
        divisionId: testDivisionId,
        format: 'double_elim',
        structure: JSON.stringify({
          winners: [],
          losers: [],
          finals: [],
          competitorCount: 2,
          positions: { winnersFinal: null, losersFinal: null, grandFinals: null, reset: null },
        }),
        matches: {
          create: [
            {
              matchNumber: 1,
              roundNumber: 1,
              bracketType: 'winners',
              status: 'completed',
              competitor1Id: registrations[0].id,
              competitor2Id: registrations[1].id,
              winnerId: registrations[0].id,
              score1: '5',
              score2: '3',
              ringNumber: 1,
            },
            {
              matchNumber: 2,
              roundNumber: 2,
              bracketType: 'winners',
              status: 'pending',
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    const db = prisma!;
    try {
      if (testTournamentId) await db.tournament.deleteMany({ where: { id: testTournamentId } });
      if (testCompetitorIds.length) await db.competitor.deleteMany({ where: { id: { in: testCompetitorIds } } });
    } catch (err) {
      console.warn('[contract-tests] Cleanup failed:', err);
    } finally {
      await db.$disconnect();
    }
  });

  it('validates the exact Prisma query used by the public scoreboard endpoints', async () => {
    const divisions = await prisma!.division.findMany(publicScoreboardDivisionArgs(testTournamentId));

    expect(() => validatePublicScoreboardResponse(divisions)).not.toThrow();
    const match = divisions[0].bracket?.matches[0];
    expect(match?.competitor1?.competitor.firstName).toBe('Alpha');
    expect(match?.winner?.competitor.firstName).toBe('Alpha');
  });

  it('the public scoreboard query returns no registration/competitor PII', async () => {
    const divisions = await prisma!.division.findMany(publicScoreboardDivisionArgs(testTournamentId));
    expectNoPii(divisions);
  });

  it('GET /api/public/scoreboard/:publicSlug returns no PII', async () => {
    const app = express();
    app.locals.prisma = prisma;
    app.use('/api/public', publicRouter);

    const res = await request(app).get(`/api/public/scoreboard/${publicSlug}`);
    expect(res.status).toBe(200);
    expect(res.body[0].bracket.matches[0].competitor1.competitor.lastName).toBe('Contract');
    expectNoPii(res.body);
  });

  it('GET /api/public/tournaments/:id/scoreboard returns no PII', async () => {
    const app = express();
    app.locals.prisma = prisma;
    app.use('/api/public', publicRouter);

    const res = await request(app).get(`/api/public/tournaments/${testTournamentId}/scoreboard?key=${publicSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.divisions).toHaveLength(1);
    expectNoPii(res.body);
  });

  it('catches missing competitor nested select', async () => {
    const divisionsWithoutNestedCompetitor = await prisma!.division.findMany({
      where: { tournamentId: testTournamentId },
      select: {
        id: true,
        name: true,
        eventType: true,
        bracket: {
          select: {
            id: true,
            format: true,
            matches: {
              select: {
                id: true,
                matchNumber: true,
                roundNumber: true,
                bracketType: true,
                status: true,
                // Missing nested competitor: returns { id } only
                competitor1: { select: { id: true } },
                competitor2: { select: { id: true } },
                winner: { select: { id: true } },
              },
            },
          },
        },
      },
    });

    expect(() => validatePublicScoreboardResponse(divisionsWithoutNestedCompetitor)).toThrow();
  });

  it('handles null bracket gracefully', async () => {
    const divisionNoBracket = await prisma!.division.create({
      data: {
        tournamentId: testTournamentId,
        name: 'No Bracket Division',
        eventType: 'patterns',
        beltLevel: 'BB',
        gender: 'F',
        ageMin: 8,
        ageMax: 10,
      },
    });

    const divisions = await prisma!.division.findMany(publicScoreboardDivisionArgs(testTournamentId));
    const result = divisions.find((d) => d.id === divisionNoBracket.id);

    expect(() => apiDivisionSchema.parse(result)).not.toThrow();
    expect(result?.bracket).toBeNull();

    await prisma!.division.delete({ where: { id: divisionNoBracket.id } });
  });
});

describe('Public Scoreboard Contract (static)', () => {
  it('rejects invalid match status values', async () => {
    const invalidDivision = {
      id: randomUUID(),
      name: 'Test',
      eventType: 'sparring',
      bracket: {
        id: randomUUID(),
        format: 'double_elim',
        matches: [
          {
            id: randomUUID(),
            matchNumber: 1,
            roundNumber: 1,
            bracketType: 'winners',
            status: 'invalid_status', // <-- not in the enum
            competitor1: null,
            competitor2: null,
            winner: null,
          },
        ],
      },
    };

    expect(() => apiDivisionSchema.parse(invalidDivision)).toThrow(/status/);
  });

  it('the public select never requests sensitive registration or competitor columns', () => {
    const keys = collectKeys(publicScoreboardDivisionArgs('00000000-0000-0000-0000-000000000000').select);
    for (const forbidden of PUBLIC_SCOREBOARD_FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `public scoreboard select requests "${forbidden}"`).toBe(false);
    }
    // Every relation is an explicit select — no `include` anywhere.
    expect(keys.has('include')).toBe(false);
  });

  it('flags PII keys in a payload (guards the checker itself)', () => {
    const leaky = [{ bracket: { matches: [{ competitor1: { id: 'x', parentEmail: 'a@b.c', competitor: {} } }] } }];
    expect(collectKeys(leaky).has('parentEmail')).toBe(true);
  });
});

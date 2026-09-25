/**
 * Divisions-with-matches contract tests.
 * 
 * Verifies that GET /api/divisions/tournament/:id?withMatches=true returns
 * the exact shape documented in the API contract. This endpoint feeds the
 * director dashboard and scorekeeper UI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  apiDivisionArraySchema,
  apiDivisionWithCountSchema,
} from '../../shared/contracts/index.js';
import { collectKeys } from '../routes/public-scoreboard-query.js';
import { connectContractDb } from './db-probe.js';

// With Prisma 7 driver adapters `$connect()` is lazy, so availability is
// decided by a real query; suites skip (not fail) without a migrated DB.
const prisma = await connectContractDb();
const dbAvailable = prisma !== null;

let testTournamentId: string;
let testDivisionId: string;
let testCompetitorId: string;
let testRegistrationId: string;

// Contact / medical / payment / token fields that must never be part of the
// documented match-slot contract (parsed output strips unknown keys).
const CONTRACT_FORBIDDEN_KEYS = [
  'parentName',
  'parentEmail',
  'parentPhone',
  'managementTokenHash',
  'managementTokenExpiresAt',
  'paymentIntentId',
  'paymentStatus',
  'dateOfBirth',
  'weightAtRegistration',
  'checkInWeight',
];

/** The contract describes the JSON wire format (Dates become ISO strings). */
const wire = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const matchInclude = {
  competitor1: { include: { competitor: true } },
  competitor2: { include: { competitor: true } },
  winner: { include: { competitor: true } },
} as const;

describe.skipIf(!dbAvailable)('Divisions-with-matches Contract (database)', () => {
beforeAll(async () => {
  const db = prisma!;
  const tournament = await db.tournament.create({
    data: {
      name: 'Divisions Contract Test',
      date: new Date('2026-12-15'),
      status: 'in_progress',
      location: 'Test Arena',
    },
  });
  testTournamentId = tournament.id;

  const competitor = await db.competitor.create({
    data: {
      firstName: 'Test',
      lastName: 'Competitor',
      dateOfBirth: new Date('2015-01-01'),
      gender: 'M',
      belt: 'Yellow',
      weightLbs: 60,
    },
  });
  testCompetitorId = competitor.id;

  const registration = await db.registration.create({
    data: {
      tournamentId: testTournamentId,
      competitorId: testCompetitorId,
      sparring: true,
      parentName: 'Parent Secret',
      parentEmail: 'parent.secret@example.test',
      parentPhone: '555-0100',
      managementTokenHash: `hash-${randomUUID()}`,
      weightAtRegistration: 60,
    },
  });
  testRegistrationId = registration.id;

  const division = await db.division.create({
    data: {
      tournamentId: testTournamentId,
      name: 'Test Division',
      eventType: 'sparring',
      beltLevel: 'CB',
      gender: 'M',
      ageMin: 8,
      ageMax: 10,
      weightClass: 'Feather',
    },
  });
  testDivisionId = division.id;

  // Add an assignment to test _count
  await db.divisionAssignment.create({
    data: {
      divisionId: testDivisionId,
      registrationId: testRegistrationId,
      seedPosition: 1,
    },
  });

  // Create bracket with matches
  await db.bracket.create({
    data: {
      divisionId: testDivisionId,
      format: 'double_elim',
      structure: JSON.stringify({
        winners: [],
        losers: [],
        finals: [],
        competitorCount: 1,
        positions: { winnersFinal: null, losersFinal: null, grandFinals: null, reset: null },
      }),
      matches: {
        create: [
          {
            matchNumber: 1,
            roundNumber: 1,
            bracketType: 'winners',
            status: 'pending',
            ringNumber: 1,
            competitor1Id: testRegistrationId,
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
    if (testCompetitorId) await db.competitor.deleteMany({ where: { id: testCompetitorId } });
  } catch (err) {
    console.warn('[contract-tests] Cleanup failed:', err);
  } finally {
    await db.$disconnect();
  }
});

  it('validates the query used by GET /api/divisions/tournament/:id?withMatches=true', async () => {
    // Mirrors the include shape of src/server/routes/divisions.ts (withMatches),
    // plus `winner`, which the shared match contract requires.
    const divisions = await prisma!.division.findMany({
      where: {
        tournamentId: testTournamentId,
        deletedAt: null,
      },
      include: {
        bracket: {
          include: {
            matches: {
              include: matchInclude,
              orderBy: { matchNumber: 'asc' },
            },
          },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    expect(() => apiDivisionArraySchema.parse(wire(divisions))).not.toThrow();
    expect(divisions).toHaveLength(1);
    expect(divisions[0].bracket?.matches).toBeDefined();
  });

  it('validates the query WITH _count for division management endpoints', async () => {
    // Some endpoints include assignment counts
    const divisions = await prisma!.division.findMany({
      where: { tournamentId: testTournamentId },
      include: {
        bracket: {
          include: {
            matches: {
              include: matchInclude,
            },
          },
        },
        _count: {
          select: { assignments: true },
        },
      },
    });

    expect(() => apiDivisionWithCountSchema.parse(wire(divisions[0]))).not.toThrow();
    expect(divisions[0]._count?.assignments).toBe(1);
  });

  it('validates matches have correct competitor slot shape', async () => {
    // Fetch the bracket and verify competitor slots are properly nested
    const division = await prisma!.division.findUnique({
      where: { id: testDivisionId },
      include: {
        bracket: {
          include: {
            matches: {
              include: matchInclude,
            },
          },
        },
      },
    });

    const match = division?.bracket?.matches[0];
    expect(match).toBeDefined();
    
    // All competitor slots should be null or have the nested { id, competitor: { ... } } shape
    if (match?.competitor1) {
      expect(match.competitor1).toHaveProperty('id');
      expect(match.competitor1).toHaveProperty('competitor');
      expect(match.competitor1.competitor).toHaveProperty('firstName');
    }
  });

  it('the documented match-slot contract carries no contact/token/payment PII', async () => {
    // The raw include (full Registration + Competitor rows) DOES contain
    // parent contact fields — which is exactly why public endpoints must
    // use the explicit select in public-scoreboard-query.ts. The contract
    // shape clients rely on must not include them.
    const divisions = await prisma!.division.findMany({
      where: { tournamentId: testTournamentId },
      include: { bracket: { include: { matches: { include: matchInclude } } } },
    });
    const rawKeys = collectKeys(JSON.parse(JSON.stringify(divisions)));
    expect(rawKeys.has('parentEmail')).toBe(true); // sanity: fixture is loaded with PII

    const parsed = apiDivisionArraySchema.parse(wire(divisions));
    expect(parsed[0].bracket?.matches[0].competitor1?.competitor.firstName).toBe('Test');
    const contractKeys = collectKeys(JSON.parse(JSON.stringify(parsed)));
    for (const forbidden of CONTRACT_FORBIDDEN_KEYS) {
      expect(contractKeys.has(forbidden), `contract exposes "${forbidden}"`).toBe(false);
    }
  });

  it('handles displayOrder and weightClass nullability correctly', async () => {
    // Create a division without displayOrder or weightClass
    const minimal = await prisma!.division.create({
      data: {
        tournamentId: testTournamentId,
        name: 'Minimal Division',
        eventType: 'patterns',
        beltLevel: 'BB',
        gender: 'F',
        ageMin: 8,
        ageMax: 10,
        // displayOrder and weightClass are nullable
      },
    });

    const result = await prisma!.division.findUnique({
      where: { id: minimal.id },
      include: {
        bracket: {
          include: {
            matches: {
              include: matchInclude,
            },
          },
        },
      },
    });

    expect(() => apiDivisionArraySchema.parse(wire([result]))).not.toThrow();
    expect(result?.displayOrder).toBeNull();
    expect(result?.weightClass).toBeNull();

    await prisma!.division.delete({ where: { id: minimal.id } });
  });
});

describe('Divisions-with-matches Contract (static)', () => {
  it('accepts divisions without the optional tournamentId field', () => {
    const division = {
      id: randomUUID(),
      name: 'Test',
      eventType: 'sparring',
      // tournamentId is intentionally omitted (not always included)
      bracket: null,
    };

    expect(() => apiDivisionWithCountSchema.parse(division)).not.toThrow();
  });

  it('strips PII keys from match competitor slots when parsed through the contract', () => {
    const division = {
      id: randomUUID(),
      name: 'Test',
      eventType: 'sparring',
      bracket: {
        id: randomUUID(),
        format: 'double_elim',
        matches: [{
          id: randomUUID(),
          matchNumber: 1,
          roundNumber: 1,
          bracketType: 'winners',
          status: 'pending',
          competitor1: {
            id: randomUUID(),
            parentEmail: 'leak@example.test',
            managementTokenHash: 'deadbeef',
            competitor: { firstName: 'A', lastName: 'B', dateOfBirth: '2015-01-01' },
          },
          competitor2: null,
          winner: null,
        }],
      },
    };
    const keys = collectKeys(apiDivisionArraySchema.parse([division]));
    for (const forbidden of CONTRACT_FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});

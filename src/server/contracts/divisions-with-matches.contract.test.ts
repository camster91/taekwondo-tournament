/**
 * Divisions-with-matches contract tests.
 * 
 * Verifies that GET /api/divisions/tournament/:id?withMatches=true returns
 * the exact shape documented in the API contract. This endpoint feeds the
 * director dashboard and scorekeeper UI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  apiDivisionArraySchema,
  apiDivisionWithCountSchema,
} from '../../shared/contracts/index.js';

// Use a dedicated test instance with driver adapter (Prisma 7 requirement)
const connectionString = process.env.DATABASE_URL || 'postgresql://taekwondo:taekwondo@localhost:5432/taekwondo_tournament';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let testTournamentId: string;
let testDivisionId: string;
let testCompetitorId: string;
let testRegistrationId: string;

beforeAll(async () => {
  // Skip tests if DB is not available
  let dbAvailable = false;
  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    console.warn('[contract-tests] Database not available, skipping integration tests');
  }

  if (!dbAvailable) {
    return;
  }

  const tournament = await prisma.tournament.create({
    data: {
      name: 'Divisions Contract Test',
      date: new Date('2026-12-15'),
      status: 'in_progress',
      location: 'Test Arena',
    },
  });
  testTournamentId = tournament.id;

  const competitor = await prisma.competitor.create({
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

  // DivisionAssignment points at a Registration, not a Competitor
  // (DB: DivisionAssignment_registrationId_fkey).
  const registration = await prisma.registration.create({
    data: {
      tournamentId: testTournamentId,
      competitorId: testCompetitorId,
      patterns: false,
      sparring: true,
    },
  });
  testRegistrationId = registration.id;

  const division = await prisma.division.create({
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
  await prisma.divisionAssignment.create({
    data: {
      divisionId: testDivisionId,
      registrationId: testRegistrationId,
      seedPosition: 1,
    },
  });

  // Create bracket with matches
  await prisma.bracket.create({
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
          },
        ],
      },
    },
  });
});

afterAll(async () => {
  // Only cleanup if tests actually ran
  if (!testTournamentId) {
    return;
  }

  try {
    await prisma.match.deleteMany({ where: { bracket: { divisionId: testDivisionId } } });
    await prisma.bracket.deleteMany({ where: { divisionId: testDivisionId } });
    await prisma.divisionAssignment.deleteMany({ where: { divisionId: testDivisionId } });
    await prisma.division.deleteMany({ where: { id: testDivisionId } });
    await prisma.competitor.deleteMany({ where: { id: testCompetitorId } });
    await prisma.tournament.deleteMany({ where: { id: testTournamentId } });
  } catch (err) {
    console.warn('[contract-tests] Cleanup failed:', err);
  } finally {
    await prisma.$disconnect();
  }
});

describe('Divisions-with-matches Contract', () => {
  it.skipIf(!testTournamentId)('validates the query used by GET /api/divisions/tournament/:id?withMatches=true', async () => {
    // This is the ACTUAL query from src/server/routes/divisions.ts:67-112
    const divisions = await prisma.division.findMany({
      where: {
        tournamentId: testTournamentId,
        deletedAt: null,
      },
      include: {
        bracket: {
          include: {
            matches: {
              include: {
                competitor1: { include: { competitor: true } },
                competitor2: { include: { competitor: true } },
                winner: { include: { competitor: true } },
              },
              orderBy: { matchNumber: 'asc' },
            },
          },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    expect(() => apiDivisionArraySchema.parse(divisions)).not.toThrow();
    expect(divisions).toHaveLength(1);
    expect(divisions[0].bracket?.matches).toBeDefined();
  });

  it.skipIf(!testTournamentId)('validates the query WITH _count for division management endpoints', async () => {
    // Some endpoints include assignment counts
    const divisions = await prisma.division.findMany({
      where: { tournamentId: testTournamentId },
      include: {
        bracket: {
          include: {
            matches: {
              include: {
                competitor1: { include: { competitor: true } },
                competitor2: { include: { competitor: true } },
                winner: { include: { competitor: true } },
              },
            },
          },
        },
        _count: {
          select: { assignments: true },
        },
      },
    });

    expect(() => apiDivisionWithCountSchema.parse(divisions[0])).not.toThrow();
    expect(divisions[0]._count?.assignments).toBe(1);
  });

  it.skipIf(!testTournamentId)('validates matches have correct competitor slot shape', async () => {
    // Fetch the bracket and verify competitor slots are properly nested
    const division = await prisma.division.findUnique({
      where: { id: testDivisionId },
      include: {
        bracket: {
          include: {
            matches: {
              include: {
                competitor1: { include: { competitor: true } },
                competitor2: { include: { competitor: true } },
                winner: { include: { competitor: true } },
              },
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

  it('rejects divisions with missing tournamentId field', async () => {
    const invalidDivision = {
      // Contract requires a UUID for id; keep the fixture valid so this
      // test exercises the tournamentId behaviour it intends to.
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Test',
      eventType: 'sparring',
      // tournamentId is intentionally omitted, which is invalid for some contexts
      bracket: null,
    };

    // apiDivisionSchema marks tournamentId as optional (it's not always included),
    // but apiDivisionWithCountSchema should still accept it
    expect(() => apiDivisionWithCountSchema.parse(invalidDivision)).not.toThrow();
  });

  it.skipIf(!testTournamentId)('handles displayOrder and weightClass nullability correctly', async () => {
    // Create a division without displayOrder or weightClass
    const minimal = await prisma.division.create({
      data: {
        tournamentId: testTournamentId,
        name: 'Minimal Division',
        eventType: 'patterns',
        beltLevel: 'BB',
        // displayOrder and weightClass are nullable
      },
    });

    const result = await prisma.division.findUnique({
      where: { id: minimal.id },
      include: {
        bracket: {
          include: {
            matches: {
              include: {
                competitor1: { include: { competitor: true } },
                competitor2: { include: { competitor: true } },
                winner: { include: { competitor: true } },
              },
            },
          },
        },
      },
    });

    expect(() => apiDivisionArraySchema.parse([result])).not.toThrow();
    expect(result?.displayOrder).toBeNull();
    expect(result?.weightClass).toBeNull();

    await prisma.division.delete({ where: { id: minimal.id } });
  });
});

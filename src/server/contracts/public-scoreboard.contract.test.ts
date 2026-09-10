/**
 * Public scoreboard contract tests.
 * 
 * These tests verify that the Prisma include shape for public scoreboard
 * endpoints matches the documented API contract. If these tests fail, either:
 * 
 * 1. The Prisma query includes have drifted (update the query)
 * 2. The contract schema is wrong (update the schema)
 * 3. A migration changed the DB shape (update both)
 * 
 * DO NOT disable these tests without team review — they guard the highest-
 * traffic public endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  validatePublicScoreboardResponse,
  apiDivisionSchema,
} from '../../shared/contracts/index.js';

// Use a dedicated test instance with driver adapter (Prisma 7 requirement)
const connectionString = process.env.DATABASE_URL || 'postgresql://taekwondo:taekwondo@localhost:5432/taekwondo_tournament';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Test data IDs for cleanup
let testTournamentId: string;
let testDivisionId: string;

beforeAll(async () => {
  // Skip tests if DB is not available (e.g., in CI without postgres)
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

  // Create minimal test tournament with division + bracket + matches
  const tournament = await prisma.tournament.create({
    data: {
      name: 'Contract Test Tournament',
      date: new Date('2026-12-01'),
      status: 'in_progress',
      location: 'Test Arena',
      publicSlug: 'test-' + Date.now().toString(36),
    },
  });
  testTournamentId = tournament.id;

  const division = await prisma.division.create({
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

  // Create bracket with matches (minimal structure for validation)
  await prisma.bracket.create({
    data: {
      divisionId: testDivisionId,
      format: 'double_elim',
      structure: JSON.stringify({
        winners: [],
        losers: [],
        finals: [],
        competitorCount: 0,
        positions: { winnersFinal: null, losersFinal: null, grandFinals: null, reset: null },
      }),
      matches: {
        create: [
          {
            matchNumber: 1,
            roundNumber: 1,
            bracketType: 'winners',
            status: 'pending',
          },
          {
            matchNumber: 2,
            roundNumber: 1,
            bracketType: 'winners',
            status: 'completed',
          },
        ],
      },
    },
  });
});

afterAll(async () => {
  // Only cleanup if tests actually ran (testTournamentId was set)
  if (!testTournamentId) {
    return;
  }

  // Cleanup: delete test data in reverse FK order
  try {
    await prisma.match.deleteMany({ where: { bracket: { divisionId: testDivisionId } } });
    await prisma.bracket.deleteMany({ where: { divisionId: testDivisionId } });
    await prisma.division.deleteMany({ where: { id: testDivisionId } });
    await prisma.tournament.deleteMany({ where: { id: testTournamentId } });
  } catch (err) {
    console.warn('[contract-tests] Cleanup failed:', err);
  } finally {
    await prisma.$disconnect();
  }
});

describe('Public Scoreboard Contract', () => {
  it.skipIf(!testTournamentId)('validates the exact Prisma include shape used by GET /api/public/scoreboard/:publicSlug', async () => {
    // This is the ACTUAL query from src/server/routes/public.ts:636-684
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

    // Contract validation must not throw
    expect(() => validatePublicScoreboardResponse(divisions)).not.toThrow();
  });

  it.skipIf(!testTournamentId)('catches missing competitor nested include', async () => {
    // Simulate the bug where we forget to include competitor details
    const divisionsWithoutNestedCompetitor = await prisma.division.findMany({
      where: { tournamentId: testTournamentId },
      include: {
        bracket: {
          include: {
            matches: {
              include: {
                // Missing: competitor1: { include: { competitor: true } }
                competitor1: true,
                competitor2: true,
                winner: true,
              },
            },
          },
        },
      },
    });

    // This SHOULD fail validation because competitor shape is wrong
    // (it returns { id, competitorId, ... } instead of { id, competitor: { firstName, ... } })
    expect(() => validatePublicScoreboardResponse(divisionsWithoutNestedCompetitor)).toThrow();
  });

  it.skipIf(!testTournamentId)('validates single division shape matches apiDivisionSchema', async () => {
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

    expect(() => apiDivisionSchema.parse(division)).not.toThrow();
  });

  it.skipIf(!testTournamentId)('handles null bracket gracefully', async () => {
    // Create a division with no bracket yet
    const divisionNoBracket = await prisma.division.create({
      data: {
        tournamentId: testTournamentId,
        name: 'No Bracket Division',
        eventType: 'patterns',
        beltLevel: 'BB',
      },
    });

    const result = await prisma.division.findUnique({
      where: { id: divisionNoBracket.id },
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

    // bracket: null is valid per the schema
    expect(() => apiDivisionSchema.parse(result)).not.toThrow();
    expect(result?.bracket).toBeNull();

    // Cleanup
    await prisma.division.delete({ where: { id: divisionNoBracket.id } });
  });

  it('rejects invalid match status values', async () => {
    const invalidDivision = {
      id: 'test-id',
      name: 'Test',
      eventType: 'sparring',
      bracket: {
        id: 'bracket-id',
        format: 'double_elim',
        matches: [
          {
            id: 'match-id',
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
});

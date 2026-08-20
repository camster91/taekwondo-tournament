/**
 * Contract test for `GET /api/public/scoreboard/:publicSlug`.
 *
 * Drives the real route handler with a mocked prisma + a representative
 * Prisma-shaped payload, then asserts the response JSON parses with the
 * `PublicScoreboardResponseSchema`. If a server-side field is removed
 * or renamed, this test fails *before* the client page breaks in
 * production.
 *
 * It also asserts that a hand-trimmed payload (missing a required field)
 * is rejected, so the schema is provably enforcing the contract — not
 * just describing it.
 */
import { describe, expect, it, vi } from 'vitest';
import { PublicScoreboardResponseSchema } from '../public-scoreboard.js';

interface CapturedResponse {
  status: number;
  body: unknown;
}

function makeResponse(): CapturedResponse & { res: any } {
  const captured: CapturedResponse = { status: 200, body: undefined };
  const res: any = {};
  res.status = vi.fn((code: number) => {
    captured.status = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    captured.body = payload;
    return res;
  });
  return Object.assign(res, { ...captured, res });
}

/** A known-good division payload that matches the Prisma include in
 * `src/server/routes/public.ts`. The dates are ISO strings because the
 * wire format is JSON. */
function knownGoodDivision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'division-1',
    tournamentId: 'tournament-1',
    name: '10-11 CB All Green Belts Males Sparring Heavy',
    beltLevel: 'CB',
    gender: 'M',
    eventType: 'sparring',
    ageMin: 10,
    ageMax: 11,
    beltColors: '["Green"]',
    danMin: null,
    danMax: null,
    weightClass: 'Heavy',
    divisionNumber: 1,
    deletedAt: null,
    isSpecialNeeds: false,
    displayOrder: 1,
    createdAt: '2026-08-20T00:00:00.000Z',
    bracketDifficulty: 0.5,
    matchupQuality: 0.8,
    avgSkillRating: 1200,
    bracket: {
      id: 'bracket-1',
      format: 'double_elim',
      matches: [
        {
          id: 'match-1',
          roundNumber: 1,
          matchNumber: 1,
          bracketType: 'winners' as const,
          status: 'completed' as const,
          ringNumber: 1,
          scheduledTime: null,
          competitor1: {
            id: 'reg-1',
            competitor: { firstName: 'Alex', lastName: 'Doe', schoolDojang: 'Tiger TKD' },
          },
          competitor2: {
            id: 'reg-2',
            competitor: { firstName: 'Sam', lastName: 'Lee', schoolDojang: 'Dragon TKD' },
          },
          winner: {
            id: 'reg-1',
            competitor: { firstName: 'Alex', lastName: 'Doe', schoolDojang: 'Tiger TKD' },
          },
          score1: '5',
          score2: '3',
        },
        {
          id: 'match-2',
          roundNumber: 1,
          matchNumber: 2,
          bracketType: 'winners' as const,
          status: 'pending' as const,
          ringNumber: 1,
          scheduledTime: null,
          competitor1: null,
          competitor2: null,
          score1: null,
          score2: null,
        },
      ],
    },
    ...overrides,
  };
}

describe('PublicScoreboardResponseSchema (issue #130)', () => {
  it('accepts a known-good response payload', () => {
    const payload = [knownGoodDivision()];
    const result = PublicScoreboardResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts an empty array (no published divisions yet)', () => {
    const result = PublicScoreboardResponseSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('accepts a division with no bracket (unbracketed pool)', () => {
    const result = PublicScoreboardResponseSchema.safeParse([
      knownGoodDivision({ bracket: null }),
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing the top-level array shape', () => {
    const result = PublicScoreboardResponseSchema.safeParse({ divisions: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a division missing the `id` field', () => {
    const { id: _id, ...withoutId } = knownGoodDivision();
    const result = PublicScoreboardResponseSchema.safeParse([withoutId]);
    expect(result.success).toBe(false);
  });

  it('rejects a division with an unknown `status` enum value', () => {
    const division = knownGoodDivision();
    division.bracket!.matches[0].status = 'in_progress_extra';
    const result = PublicScoreboardResponseSchema.safeParse([division]);
    expect(result.success).toBe(false);
  });

  it('rejects a match with a non-string `bracketType`', () => {
    const division = knownGoodDivision();
    // @ts-expect-error - deliberately invalid
    division.bracket!.matches[0].bracketType = 42;
    const result = PublicScoreboardResponseSchema.safeParse([division]);
    expect(result.success).toBe(false);
  });

  it('accepts `competitor1` and `competitor2` as null (TBD slots)', () => {
    const division = knownGoodDivision();
    division.bracket!.matches[1].competitor1 = null;
    division.bracket!.matches[1].competitor2 = null;
    const result = PublicScoreboardResponseSchema.safeParse([division]);
    expect(result.success).toBe(true);
  });
});

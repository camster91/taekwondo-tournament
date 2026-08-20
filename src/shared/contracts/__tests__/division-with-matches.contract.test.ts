/**
 * Contract test for `GET /api/divisions/tournament/:tournamentId?withMatches=true`.
 *
 * The handler returns an array of division objects with the Prisma
 * `bracket` include (matches, competitor1, competitor2). The schema must
 * accept that exact shape, and must reject subtle drift (renamed field,
 * wrong type, missing `competitor.id`).
 */
import { describe, expect, it } from 'vitest';
import { DivisionWithMatchesResponseSchema } from '../division-with-matches.js';

function knownGoodDivisionWithMatches() {
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
    _count: { assignments: 4 },
    bracket: {
      id: 'bracket-1',
      structure: '{"rounds":1}',
      format: 'double_elim',
      matches: [
        {
          id: 'match-1',
          roundNumber: 1,
          matchNumber: 1,
          bracketType: 'winners' as const,
          status: 'in_progress' as const,
          ringNumber: 2,
          competitor1: {
            id: 'reg-1',
            competitor: {
              id: 'competitor-1',
              firstName: 'Alex',
              lastName: 'Doe',
              schoolDojang: 'Tiger TKD',
            },
          },
          competitor2: {
            id: 'reg-2',
            competitor: {
              id: 'competitor-2',
              firstName: 'Sam',
              lastName: 'Lee',
              schoolDojang: null,
            },
          },
        },
      ],
      placements: [
        { place: 1, registrationId: 'reg-1' },
        { place: 2, registrationId: 'reg-2' },
      ],
    },
  };
}

describe('DivisionWithMatchesResponseSchema (issue #130)', () => {
  it('accepts a known-good response payload', () => {
    const result = DivisionWithMatchesResponseSchema.safeParse([
      knownGoodDivisionWithMatches(),
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts a division with `_count` omitted (legacy clients)', () => {
    const division = knownGoodDivisionWithMatches();
    delete (division as { _count?: unknown })._count;
    const result = DivisionWithMatchesResponseSchema.safeParse([division]);
    expect(result.success).toBe(true);
  });

  it('rejects a match competitor missing the `competitor.id` field', () => {
    const division = knownGoodDivisionWithMatches();
    // Drop competitor.id — a real bug if the server Prisma `select`
    // is reduced without telling the client.
    const { id: _omit, ...withoutCompetitorId } =
      division.bracket.matches[0].competitor1.competitor;
    division.bracket.matches[0].competitor1.competitor = withoutCompetitorId;
    const result = DivisionWithMatchesResponseSchema.safeParse([division]);
    expect(result.success).toBe(false);
  });

  it('rejects an empty top-level object (route returns an array)', () => {
    const result = DivisionWithMatchesResponseSchema.safeParse({
      divisions: [knownGoodDivisionWithMatches()],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer `roundNumber`', () => {
    const division = knownGoodDivisionWithMatches();
    division.bracket.matches[0].roundNumber = 1.5;
    const result = DivisionWithMatchesResponseSchema.safeParse([division]);
    expect(result.success).toBe(false);
  });
});

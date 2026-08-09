import { describe, expect, it } from 'vitest';
import {
  DIVISION_RECOMMENDATION_TYPE,
  buildDivisionRecommendation,
  loadDivisionRecommendationInput,
  validateDivisionRecommendationSnapshot,
} from './division-recommendations.js';

const registration = (overrides: Record<string, unknown> = {}) => ({
  id: 'registration-1',
  competitorId: 'competitor-1',
  patterns: true,
  sparring: false,
  ageAtTournament: 10,
  weightAtRegistration: 70,
  manualDivisionId: null,
  competeWithOlder: false,
  competitor: {
    firstName: 'Amina',
    lastName: 'Rahman',
    belt: 'Yellow',
    beltColor: 'Yellow',
    gender: 'F',
    schoolDojang: 'North Star',
    weightLbs: 70,
    danRank: null,
  },
  ...overrides,
});

describe('buildDivisionRecommendation', () => {
  it('preserves pinned registrations and identifies incomplete records without inventing values', () => {
    const pinned = registration({
      id: 'pinned-registration',
      competitorId: 'pinned-competitor',
      manualDivisionId: 'pinned-division',
      competitor: {
        ...registration().competitor,
        firstName: 'Pinned',
        lastName: 'Athlete',
      },
    });
    const missingAge = registration({
      id: 'missing-age',
      competitorId: 'missing-age-competitor',
      ageAtTournament: null,
      competitor: {
        ...registration().competitor,
        firstName: 'Age',
        lastName: 'Needed',
      },
    });
    const missingWeight = registration({
      id: 'missing-weight',
      competitorId: 'missing-weight-competitor',
      patterns: false,
      sparring: true,
      weightAtRegistration: null,
      competitor: {
        ...registration().competitor,
        firstName: 'Weight',
        lastName: 'Needed',
        weightLbs: null,
      },
    });

    const recommendation = buildDivisionRecommendation({
      tournamentId: 'tournament-1',
      registrations: [registration(), pinned, missingAge, missingWeight],
      config: { divisionThreshold: 8 },
    });

    expect(recommendation.recommendationType).toBe(DIVISION_RECOMMENDATION_TYPE);
    expect(recommendation.proposedDiff.preservedPinned).toEqual([
      expect.objectContaining({ registrationId: 'pinned-registration', divisionId: 'pinned-division' }),
    ]);
    expect(recommendation.proposedDiff.excluded).toEqual([
      expect.objectContaining({ registrationId: 'missing-age', reasons: ['missing tournament age'] }),
      expect.objectContaining({ registrationId: 'missing-weight', reasons: ['missing weight'] }),
    ]);
    const proposedIds = recommendation.proposedDiff.divisions.flatMap((division) =>
      division.registrations.map((entry) => entry.registrationId),
    );
    expect(proposedIds).toEqual(['registration-1']);
    expect(recommendation.constraintsConsidered).toEqual(expect.arrayContaining([
      'Manual division pins are immutable',
      'Tournament age is never inferred',
      'Sparring weight is never inferred',
    ]));
    expect(recommendation.warnings.join(' ')).toContain('missing tournament age');
    expect(recommendation.warnings.join(' ')).toContain('missing weight');
  });

  it('produces stable input and proposed-output versions for the same fixture', () => {
    const input = {
      tournamentId: 'tournament-1',
      registrations: [registration(), registration({ id: 'registration-2', competitorId: 'competitor-2' })],
      config: { divisionThreshold: 8 },
    };

    const first = buildDivisionRecommendation(input);
    const second = buildDivisionRecommendation({ ...input, registrations: [...input.registrations].reverse() });

    expect(first.inputVersion).toBe(second.inputVersion);
    expect(first.resultVersion).toBe(second.resultVersion);
    expect(first.proposedDiff).toEqual(second.proposedDiff);
  });

  it('fails closed when a pin, source fact, or proposed assignment is changed', () => {
    const originalInput = {
      tournamentId: 'tournament-1',
      registrations: [registration(), registration({
        id: 'pinned-registration', competitorId: 'pinned-competitor', manualDivisionId: 'pinned-division',
      })],
      config: { divisionThreshold: 8 },
    };
    const proposal = buildDivisionRecommendation(originalInput);

    expect(validateDivisionRecommendationSnapshot(originalInput, proposal)).toMatchObject({ valid: true });
    expect(validateDivisionRecommendationSnapshot({
      ...originalInput,
      registrations: originalInput.registrations.map((entry) =>
        entry.id === 'pinned-registration' ? { ...entry, manualDivisionId: 'different-division' } : entry),
    }, proposal)).toMatchObject({ valid: false, errors: expect.arrayContaining(['Tournament inputs changed since this recommendation was created']) });
    expect(validateDivisionRecommendationSnapshot(originalInput, {
      ...proposal,
      proposedDiff: { ...proposal.proposedDiff, preservedPinned: [] },
    })).toMatchObject({ valid: false, errors: expect.arrayContaining(['Proposed division output was changed after deterministic generation']) });
  });

  it('loads custom weight-class precedence in explicit display order with a stable tie-breaker', async () => {
    const db = {
      tournament: { findUnique: async () => ({ id: 'tournament-1', settings: null, sportProfileSlug: 'taekwondo' }) },
      registration: { findMany: async () => [] },
      weightClass: { findMany: async (args: unknown) => {
        expect(args).toEqual({
          where: { tournamentId: 'tournament-1' },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        });
        return [];
      } },
    };

    await loadDivisionRecommendationInput(db as never, 'tournament-1');
  });
});

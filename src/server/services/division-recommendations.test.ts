import { describe, expect, it, vi } from 'vitest';
import {
  DIVISION_RECOMMENDATION_TYPE,
  buildDivisionRecommendation,
  loadDivisionRecommendationInput,
  assertDivisionRecommendationCanApply,
  validateDivisionRecommendationSnapshot,
  validateDivisionRecommendation,
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
      existingDivisions: [{ id: 'division-1', name: 'Original division', assignments: [], bracketId: null }],
    };
    const proposal = buildDivisionRecommendation(originalInput);

    expect(validateDivisionRecommendationSnapshot(originalInput, proposal)).toMatchObject({ valid: true });
    expect(validateDivisionRecommendationSnapshot({
      ...originalInput,
      registrations: originalInput.registrations.map((entry) =>
        entry.id === 'pinned-registration' ? { ...entry, manualDivisionId: 'different-division' } : entry),
    }, proposal)).toMatchObject({ valid: false, errors: expect.arrayContaining(['Tournament inputs changed since this recommendation was created']) });
    expect(validateDivisionRecommendationSnapshot({
      ...originalInput,
      existingDivisions: [{ ...originalInput.existingDivisions[0], name: 'Director renamed division' }],
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
      division: { findMany: async () => [] },
    };

    await loadDivisionRecommendationInput(db as never, 'tournament-1');
  });

  it('derives an immutable pin from a manual assignment even when the registration pin field is empty', async () => {
    const manuallyAssigned = {
      ...registration(),
      manualDivisionId: null,
      assignments: [{ divisionId: 'director-picked-division', manualOverride: true }],
    };
    const db = {
      tournament: { findUnique: async () => ({ id: 'tournament-1', settings: null, sportProfileSlug: 'taekwondo' }) },
      registration: { findMany: async () => [
        manuallyAssigned,
        { ...registration({ id: 'teammate-registration', competitorId: 'teammate-competitor' }), assignments: [] },
      ] },
      weightClass: { findMany: async () => [] },
      division: { findMany: async () => [{
        id: 'director-picked-division', name: 'Director picked division', bracket: null,
        assignments: [
          { id: 'a1', registrationId: 'registration-1', seedPosition: 1, manualOverride: true },
          { id: 'a2', registrationId: 'teammate-registration', seedPosition: 2, manualOverride: false },
        ],
      }] },
    };

    const loaded = await loadDivisionRecommendationInput(db as never, 'tournament-1');
    expect(loaded.registrations[0].manualDivisionId).toBe('director-picked-division');
    expect(loaded.registrations[1].manualDivisionId).toBe('director-picked-division');
    expect(buildDivisionRecommendation(loaded).proposedDiff.preservedPinned).toEqual([
      expect.objectContaining({ registrationId: 'registration-1', divisionId: 'director-picked-division' }),
      expect.objectContaining({ registrationId: 'teammate-registration', divisionId: 'director-picked-division' }),
    ]);
  });

  it('preserves every member of a division referenced by the direct registration pin field', async () => {
    const directPin = { ...registration(), manualDivisionId: 'direct-pin-division', assignments: [] };
    const teammate = { ...registration({ id: 'direct-pin-teammate', competitorId: 'direct-pin-teammate-competitor' }), assignments: [] };
    const division = {
      id: 'direct-pin-division', name: 'Direct pin division', bracket: null,
      assignments: [
        { id: 'direct-a1', registrationId: 'registration-1', seedPosition: 1, manualOverride: false },
        { id: 'direct-a2', registrationId: 'direct-pin-teammate', seedPosition: 2, manualOverride: false },
      ],
    };
    const db = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      tournament: { findUnique: async () => ({ id: 'tournament-1', settings: null, sportProfileSlug: 'taekwondo' }) },
      registration: { findMany: async () => [directPin, teammate] },
      weightClass: { findMany: async () => [] },
      division: { findMany: async () => [division] },
    };

    const loaded = await loadDivisionRecommendationInput(db as never, 'tournament-1');
    expect(loaded.registrations.map((entry) => entry.manualDivisionId)).toEqual([
      'direct-pin-division', 'direct-pin-division',
    ]);
    expect(buildDivisionRecommendation(loaded).proposedDiff.divisions).toEqual([]);
  });

  it('refuses recategorization when an existing bracket would be destroyed', () => {
    expect(() => assertDivisionRecommendationCanApply([
      { name: 'Girls Patterns', bracket: { id: 'bracket-1' } },
    ])).toThrow('Remove or correct existing brackets before applying a division recommendation');
    expect(() => assertDivisionRecommendationCanApply([
      { name: 'Girls Patterns', bracket: null },
    ])).not.toThrow();
  });

  it('locks every authoritative tournament input before transactional validation', async () => {
    const db = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      tournament: { findUnique: async () => ({ id: 'tournament-1', settings: null, sportProfileSlug: 'taekwondo' }) },
      registration: { findMany: async () => [{ ...registration(), assignments: [] }] },
      weightClass: { findMany: async () => [] },
      division: { findMany: async () => [] },
    };
    const input = await loadDivisionRecommendationInput(db as never, 'tournament-1');
    const proposal = buildDivisionRecommendation(input);

    await validateDivisionRecommendation(db as never, {
      tournamentId: 'tournament-1',
      recommendationType: proposal.recommendationType,
      inputSnapshot: proposal.inputSnapshot,
      proposedDiff: proposal.proposedDiff,
    });

    expect(db.$queryRawUnsafe.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT id FROM "Tournament" WHERE id = $1 FOR UPDATE',
      'SELECT id FROM "Registration" WHERE "tournamentId" = $1 ORDER BY id FOR UPDATE',
      'SELECT c.id FROM "Competitor" c JOIN "Registration" r ON r."competitorId" = c.id WHERE r."tournamentId" = $1 ORDER BY c.id FOR UPDATE OF c',
      'SELECT id FROM "WeightClass" WHERE "tournamentId" = $1 ORDER BY id FOR UPDATE',
      'SELECT id FROM "Division" WHERE "tournamentId" = $1 ORDER BY id FOR UPDATE',
      'SELECT a.id FROM "DivisionAssignment" a JOIN "Division" d ON d.id = a."divisionId" WHERE d."tournamentId" = $1 ORDER BY a.id FOR UPDATE OF a',
    ]);
  });
});

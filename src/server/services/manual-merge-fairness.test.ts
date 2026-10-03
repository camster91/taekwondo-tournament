/**
 * Manual merges vs fairness limits: warn, don't block.
 */
import { describe, expect, it } from 'vitest';
import type { RegistrationWithCompetitor } from './categorization-engine.js';
import {
  fairnessLimitConflict,
  hasFairnessLimits,
  manualMergeLimitBreaks,
} from './manual-merge-fairness.js';
import {
  DEFAULT_FAIR_DIVISION_RULES,
  DEFAULT_TOURNAMENT_RULES,
  type FairnessLimit,
  type TournamentRules,
} from '../../shared/constants/tournament-rules.js';

const reg = (first: string, last: string, o: { age?: number; weight?: number } = {}): RegistrationWithCompetitor => ({
  id: `${first}-${last}`,
  competitorId: `c-${first}-${last}`,
  patterns: false,
  sparring: true,
  ageAtTournament: o.age ?? 10,
  weightAtRegistration: o.weight ?? null,
  manualDivisionId: null,
  competitor: {
    firstName: first,
    lastName: last,
    belt: 'Yellow',
    gender: 'M',
    weightLbs: o.weight ?? null,
  },
});

const rulesWith = (limits: FairnessLimit[]): TournamentRules => ({
  ...DEFAULT_TOURNAMENT_RULES,
  fairness: { ...DEFAULT_FAIR_DIVISION_RULES, limits },
});

const sparring = (ageMin: number, ageMax: number) => ({ eventType: 'sparring', ageMin, ageMax });

describe('manualMergeLimitBreaks', () => {
  const people = [
    reg('Sam', 'Lee', { age: 10, weight: 60 }),
    reg('Kai', 'Moe', { age: 10, weight: 66 }),
    reg('Ana', 'Park', { age: 11, weight: 74 }),
  ];

  it('finds nothing when no limits are set (merge works as before)', () => {
    expect(hasFairnessLimits(DEFAULT_TOURNAMENT_RULES)).toBe(false);
    expect(hasFairnessLimits(undefined)).toBe(false);
    expect(manualMergeLimitBreaks(sparring(10, 11), [sparring(10, 11)], people, DEFAULT_TOURNAMENT_RULES)).toEqual([]);
  });

  it('names the pair furthest apart over the weight limit, in plain words', () => {
    const rules = rulesWith([{ ageMin: 8, ageMax: 12, maxWeightGapLbs: 10 }]);
    const breaks = manualMergeLimitBreaks(sparring(10, 10), [sparring(11, 11)], people, rules);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ kind: 'weight', low: 'Sam Lee', high: 'Ana Park', gap: 14, limit: 10, unit: 'lb' });
    expect(breaks[0].message).toBe('This puts 14 lb between Sam Lee and Ana Park, above your 10 lb limit.');
  });

  it('keeps quiet when the merged group stays within the limit', () => {
    const rules = rulesWith([{ ageMin: 8, ageMax: 12, maxWeightGapLbs: 20, maxAgeGapYears: 2 }]);
    expect(manualMergeLimitBreaks(sparring(10, 10), [sparring(11, 11)], people, rules)).toEqual([]);
  });

  it('checks the age limit for every event, over the merged ages', () => {
    // The 12-13 limit applies because the merged division reaches 12.
    const rules = rulesWith([{ ageMin: 12, ageMax: 13, maxAgeGapYears: 1 }]);
    const group = [reg('Sam', 'Lee', { age: 10 }), reg('Ana', 'Park', { age: 12 })];
    const patterns = (ageMin: number, ageMax: number) => ({ eventType: 'patterns', ageMin, ageMax });
    expect(manualMergeLimitBreaks(patterns(10, 11), [], group, rules)).toEqual([]);
    const breaks = manualMergeLimitBreaks(patterns(10, 11), [patterns(12, 12)], group, rules);
    expect(breaks.map((b) => b.message)).toEqual([
      'This puts 2 years between Sam Lee and Ana Park, above your 1 year limit.',
    ]);
  });

  it('ignores the weight limit for patterns', () => {
    const rules = rulesWith([{ ageMin: 8, ageMax: 12, maxWeightGapLbs: 5 }]);
    const patterns = { eventType: 'patterns', ageMin: 10, ageMax: 11 };
    expect(manualMergeLimitBreaks(patterns, [patterns], people, rules)).toEqual([]);
  });

  it('counts a person listed twice once', () => {
    const rules = rulesWith([{ ageMin: 8, ageMax: 12, maxWeightGapLbs: 10 }]);
    const breaks = manualMergeLimitBreaks(sparring(10, 11), [], [...people, people[0]], rules);
    expect(breaks).toHaveLength(1);
  });
});

describe('fairnessLimitConflict', () => {
  const rules = rulesWith([{ ageMin: 8, ageMax: 12, maxWeightGapLbs: 10 }]);
  const breaks = manualMergeLimitBreaks(
    sparring(10, 11),
    [],
    [reg('Sam', 'Lee', { weight: 60 }), reg('Ana', 'Park', { weight: 74 })],
    rules,
  );

  it('asks for confirmation (409 body) when a limit is broken', () => {
    expect(fairnessLimitConflict(breaks, false)).toEqual({
      error: 'This puts 14 lb between Sam Lee and Ana Park, above your 10 lb limit.',
      code: 'FAIRNESS_LIMIT',
      message: 'This puts 14 lb between Sam Lee and Ana Park, above your 10 lb limit.',
      details: breaks,
    });
  });

  it('lets the merge go ahead once the director confirms', () => {
    expect(fairnessLimitConflict(breaks, true)).toBeNull();
  });

  it('lets the merge go ahead when nothing is broken', () => {
    expect(fairnessLimitConflict([], false)).toBeNull();
  });
});

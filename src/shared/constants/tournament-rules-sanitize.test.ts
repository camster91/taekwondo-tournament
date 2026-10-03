import { describe, expect, it } from 'vitest';
import { DEFAULT_DIVISION_RULES, DEFAULT_FAIR_DIVISION_RULES, parseTournamentRules, serializeTournamentRules } from './tournament-rules';

describe('parseTournamentRules division sizes', () => {
  const sizes = (divisions: Record<string, unknown>) =>
    parseTournamentRules(JSON.stringify({ divisions })).divisions;

  it('clamps stored sizes to the editor ranges', () => {
    expect(sizes({ maxDivisionSize: 0, minDivisionSize: -3 })).toMatchObject({ maxDivisionSize: 4, minDivisionSize: 1 });
    expect(sizes({ maxDivisionSize: 500, minDivisionSize: 50 })).toMatchObject({ maxDivisionSize: 64, minDivisionSize: 10 });
    expect(sizes({ maxDivisionSize: 12.6 })).toMatchObject({ maxDivisionSize: 13 });
  });

  it('falls back to defaults for non-numeric sizes', () => {
    expect(sizes({ maxDivisionSize: 'x', minDivisionSize: null })).toMatchObject({
      maxDivisionSize: DEFAULT_DIVISION_RULES.maxDivisionSize,
      minDivisionSize: DEFAULT_DIVISION_RULES.minDivisionSize,
    });
  });
});

describe('parseTournamentRules fairness settings', () => {
  const fairness = (value: unknown) => parseTournamentRules(JSON.stringify({ fairness: value })).fairness;

  it('defaults to everything off', () => {
    expect(parseTournamentRules(null).fairness).toEqual(DEFAULT_FAIR_DIVISION_RULES);
    expect(fairness(undefined)).toEqual(DEFAULT_FAIR_DIVISION_RULES);
    expect(fairness('nonsense')).toEqual(DEFAULT_FAIR_DIVISION_RULES);
  });

  it('keeps valid limits and aliases and drops junk', () => {
    expect(fairness({
      splitBySimilarity: true,
      heightTieBreak: 'yes',
      limits: [
        { ageMin: 6, ageMax: 7, maxWeightGapLbs: 8, maxAgeGapYears: 1.6 },
        { ageMin: 12, ageMax: 8, maxWeightGapLbs: -5 },
        'bad',
        { ageMin: 18, maxWeightGapLbs: 9999 },
      ],
      schoolAliases: [
        { alias: ' Newtons TKD (Markham) ', school: 'Newtons TKD' },
        { alias: '', school: 'X' },
        { alias: 'Y' },
        null,
      ],
      schoolShareWarningPercent: 250,
      unknownKey: true,
    })).toEqual({
      splitBySimilarity: true,
      heightTieBreak: false,
      limits: [
        { ageMin: 6, ageMax: 7, maxWeightGapLbs: 8, maxAgeGapYears: 2 },
        { ageMin: 12, ageMax: 12 },
        { ageMin: 18, ageMax: 120, maxWeightGapLbs: 500 },
      ],
      schoolAliases: [{ alias: 'Newtons TKD (Markham)', school: 'Newtons TKD' }],
      schoolShareWarningPercent: 100,
    });
  });

  it('round-trips through serialize', () => {
    const rules = parseTournamentRules(JSON.stringify({
      fairness: { limits: [{ ageMin: 4, ageMax: 5, maxWeightGapLbs: 5 }], schoolShareWarningPercent: 50 },
    }));
    expect(parseTournamentRules(serializeTournamentRules(rules)).fairness).toEqual(rules.fairness);
  });
});

describe('parseTournamentRules black belt age bands and auto weights', () => {
  it('keeps clean black belt bands and leaves them unset by default', () => {
    expect(parseTournamentRules(null).ageBands.blackBeltBands).toBeUndefined();
    expect(parseTournamentRules(JSON.stringify({
      ageBands: { blackBeltBands: [{ min: 4, max: 11, label: '11 and Under' }, { min: 15, max: 12 }, 'x'] },
    })).ageBands.blackBeltBands).toEqual([
      { min: 4, max: 11, label: '11 and Under' },
      { min: 15, max: 15, label: '15-15' },
    ]);
    expect(parseTournamentRules(JSON.stringify({ ageBands: { blackBeltBands: [] } })).ageBands.blackBeltBands).toBeUndefined();
  });

  it('clamps the most automatic weight classes', () => {
    expect(parseTournamentRules(JSON.stringify({ weights: { autoMaxClasses: 50 } })).weights.autoMaxClasses).toBe(8);
    expect(parseTournamentRules(JSON.stringify({ weights: { autoMaxClasses: 0 } })).weights.autoMaxClasses).toBe(1);
    expect(parseTournamentRules(null).weights.autoMaxClasses).toBeUndefined();
  });
});

/**
 * Fair automatic sorting (roadmap items 2, 3, 4, 5, 7, 16). Everything
 * here is opt-in through the tournament rules; the default rules must
 * give the same divisions as before.
 */
import { describe, expect, it } from 'vitest';
import {
  autoWeightClasses,
  fairnessLimitFor,
  fairnessWarnings,
  partitionSorted,
  previewCategorization,
  type CategorizationConfig,
  type RegistrationWithCompetitor,
} from './categorization-engine.js';
import {
  DEFAULT_FAIR_DIVISION_RULES,
  DEFAULT_TOURNAMENT_RULES,
  type FairDivisionRules,
  type TournamentRules,
} from '../../shared/constants/tournament-rules.js';
import { BB_AGE_GROUPS } from '../../shared/constants/age-groups.js';

const reg = (id: string, o: {
  age?: number;
  weight?: number;
  height?: number;
  belt?: string;
  school?: string | null;
  sparring?: boolean;
  gender?: string;
} = {}): RegistrationWithCompetitor => ({
  id,
  competitorId: `c-${id}`,
  patterns: !o.sparring,
  sparring: !!o.sparring,
  ageAtTournament: o.age ?? 10,
  weightAtRegistration: o.weight ?? null,
  heightAtRegistration: o.height ?? null,
  manualDivisionId: null,
  competitor: {
    firstName: id,
    lastName: 'Test',
    belt: o.belt ?? 'Yellow',
    gender: o.gender ?? 'M',
    schoolDojang: o.school ?? null,
    weightLbs: o.weight ?? null,
    danRank: o.belt === 'Black' ? 1 : null,
  },
});

const rulesWith = (patch: {
  fairness?: Partial<FairDivisionRules>;
  weights?: Partial<TournamentRules['weights']>;
  ageBands?: Partial<TournamentRules['ageBands']>;
  divisions?: Partial<TournamentRules['divisions']>;
} = {}): TournamentRules => ({
  ...DEFAULT_TOURNAMENT_RULES,
  ageBands: { ...DEFAULT_TOURNAMENT_RULES.ageBands, ...patch.ageBands },
  weights: { ...DEFAULT_TOURNAMENT_RULES.weights, ...patch.weights },
  divisions: { ...DEFAULT_TOURNAMENT_RULES.divisions, ...patch.divisions },
  fairness: { ...DEFAULT_FAIR_DIVISION_RULES, ...patch.fairness },
});

const config = (rules: TournamentRules, extra: Partial<CategorizationConfig> = {}): CategorizationConfig => ({
  divisionThreshold: 16,
  rules,
  ...extra,
});

const idsIn = (division: { competitors: { registrationId: string }[] }) =>
  division.competitors.map((c) => c.registrationId);

describe('partitionSorted', () => {
  it('cuts into parts of similar size', () => {
    expect(partitionSorted([60, 61, 62, 70, 71, 72], 2)).toEqual([3, 3]);
    expect(partitionSorted([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([3, 3, 3]);
  });

  it('prefers the biggest jump between equally balanced cuts', () => {
    // 3/4 and 4/3 are equally balanced; the jump 4 -> 10 is the natural break.
    expect(partitionSorted([1, 2, 3, 4, 10, 11, 12], 2)).toEqual([4, 3]);
  });

  it('adds parts so no part spans more than the max spread', () => {
    expect(partitionSorted([50, 52, 54, 80], 1, 10)).toEqual([3, 1]);
    const sizes = partitionSorted([40, 45, 50, 55, 60, 65, 70, 75], 2, 10);
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    let at = 0;
    const values = [40, 45, 50, 55, 60, 65, 70, 75];
    for (const size of sizes) {
      expect(values[at + size - 1] - values[at]).toBeLessThanOrEqual(10);
      at += size;
    }
  });

  it('handles empty input and never makes more parts than values', () => {
    expect(partitionSorted([], 3)).toEqual([]);
    expect(partitionSorted([5, 6], 5)).toEqual([1, 1]);
    expect(partitionSorted([5, 6, 7], 0)).toEqual([3]);
  });
});

describe('auto weight classes', () => {
  const twelve = [115, 60, 95, 65, 100, 70, 105, 75, 110, 80, 85, 90].map((weight, i) =>
    reg(`w${weight}`, { weight, sparring: true, age: 10 + (i % 2) }),
  );

  it('cuts a sparring group into Light / Middle / Heavy of similar size by weight', () => {
    const preview = previewCategorization(twelve, config(rulesWith({ weights: { strategy: 'auto', targetClassSize: 4 } })));
    expect(preview.divisions.map((d) => d.weightClass)).toEqual(['Light', 'Middle', 'Heavy']);
    expect(preview.divisions.map((d) => d.competitorCount)).toEqual([4, 4, 4]);
    expect(idsIn(preview.divisions[0]).sort()).toEqual(['w60', 'w65', 'w70', 'w75']);
    expect(idsIn(preview.divisions[2]).sort()).toEqual(['w100', 'w105', 'w110', 'w115']);
    expect(preview.divisions[0].name).toMatch(/Sparring Light$/);
  });

  it('respects the most classes and a small-group skip', () => {
    const two = previewCategorization(twelve, config(rulesWith({ weights: { strategy: 'auto', targetClassSize: 4, autoMaxClasses: 2 } })));
    expect(two.divisions.map((d) => d.weightClass)).toEqual(['Light', 'Heavy']);

    const small = previewCategorization(twelve.slice(0, 3), config(rulesWith({ weights: { strategy: 'auto' } })));
    expect(small.divisions).toHaveLength(1);
    expect(small.divisions[0].weightClass).toBeNull();
  });

  it('adds a class when a weight limit for the age band would be broken', () => {
    const regs = [60, 61, 62, 63, 64, 90].map((weight) => reg(`w${weight}`, { weight, sparring: true }));
    const preview = previewCategorization(
      regs,
      config(rulesWith({
        weights: { strategy: 'auto', targetClassSize: 6 },
        fairness: { limits: [{ ageMin: 10, ageMax: 11, maxWeightGapLbs: 10 }] },
      })),
    );
    expect(preview.divisions.map((d) => d.competitorCount)).toEqual([5, 1]);
    expect(idsIn(preview.divisions[1])).toEqual(['w90']);
    expect(preview.warnings.some((w) => w.includes('Weight gap over the limit'))).toBe(false);
  });

  it('uses height to order people of the same weight when enabled', () => {
    const regs = [
      reg('light', { weight: 60, height: 50, sparring: true }),
      reg('tall', { weight: 70, height: 60, sparring: true }),
      reg('short', { weight: 70, height: 50, sparring: true }),
      reg('heavy', { weight: 80, height: 62, sparring: true }),
    ];
    const options = { targetClassSize: 2, maxClasses: 2, skipIfSmallerThan: 2 };
    const without = autoWeightClasses(regs, options);
    expect(without[0].registrations.map((r) => r.id)).toEqual(['light', 'tall']);
    const withHeight = autoWeightClasses(regs, { ...options, heightTieBreak: true });
    expect(withHeight[0].registrations.map((r) => r.id)).toEqual(['light', 'short']);
    expect(withHeight.map((g) => g.weightClass)).toEqual(['Light', 'Heavy']);
  });

  it('keeps the weight tables when the strategy is standard (the default)', () => {
    const preview = previewCategorization(twelve, config(DEFAULT_TOURNAMENT_RULES));
    // Standard 10-11 male tables, not a relative cut.
    expect(preview.divisions.map((d) => [d.weightClass, d.competitorCount])).toEqual([
      ['Heavy', 6], ['Light', 2], ['Middle', 4],
    ]);
    const sameAsNoFairness = previewCategorization(twelve, config({ ...DEFAULT_TOURNAMENT_RULES, fairness: undefined }));
    expect(preview).toEqual(sameAsNoFairness);
  });
});

describe('splitting big divisions by similarity', () => {
  it('splits sparring by weight instead of dealing people out', () => {
    const weights = [90, 62, 85, 60, 88, 64, 86, 61, 87, 63];
    // Light people train at one school, heavy at another, so dealing
    // out by school mixes them.
    const regs = weights.map((weight) => reg(`w${weight}`, { weight, sparring: true, school: weight < 80 ? 'Alpha' : 'Beta' }));
    const rules = rulesWith({ weights: { strategy: 'auto', autoMaxClasses: 1 }, fairness: { splitBySimilarity: true } });
    const preview = previewCategorization(regs, config(rules, { divisionThreshold: 5 }));
    expect(preview.divisions).toHaveLength(2);
    expect(idsIn(preview.divisions[0]).sort()).toEqual(['w60', 'w61', 'w62', 'w63', 'w64']);
    expect(preview.divisions[0].name).toMatch(/DIV1$/);

    // Default: dealt out, so both halves mix light and heavy.
    const dealt = previewCategorization(regs, config({ ...rules, fairness: DEFAULT_FAIR_DIVISION_RULES }, { divisionThreshold: 5 }));
    expect(idsIn(dealt.divisions[0]).sort()).not.toEqual(['w60', 'w61', 'w62', 'w63', 'w64']);
  });

  it('splits patterns by age, keeping each age together', () => {
    const ages = [9, 8, 9, 8, 9, 8, 9, 8];
    const regs = ages.map((age, i) => reg(`p${i}-${age}`, { age }));
    const preview = previewCategorization(
      regs,
      config(rulesWith({ fairness: { splitBySimilarity: true } }), { divisionThreshold: 4 }),
    );
    expect(preview.divisions).toHaveLength(2);
    expect(idsIn(preview.divisions[0]).every((id) => id.endsWith('-8'))).toBe(true);
    expect(idsIn(preview.divisions[1]).every((id) => id.endsWith('-9'))).toBe(true);
  });

  it('splits patterns by belt first when the rules split by belt', () => {
    const regs = [
      reg('g8', { age: 8, belt: 'Green' }), reg('y8', { age: 8, belt: 'Yellow' }),
      reg('g9', { age: 9, belt: 'Green' }), reg('y9', { age: 9, belt: 'Yellow' }),
    ];
    // Put both belts in one group so only the split separates them.
    const preview = previewCategorization(
      regs,
      config(rulesWith({ fairness: { splitBySimilarity: true }, divisions: { splitBy: 'belt' } }), { divisionThreshold: 2 }),
    );
    const sets = preview.divisions.map((d) => idsIn(d).sort().join(','));
    expect(sets).toContain('g8,g9');
    expect(sets).toContain('y8,y9');
  });
});

describe('fairness limits', () => {
  it('applies the strictest limit overlapping a division', () => {
    const rules = rulesWith({ fairness: { limits: [
      { ageMin: 6, ageMax: 7, maxWeightGapLbs: 8 },
      { ageMin: 8, ageMax: 9, maxWeightGapLbs: 10, maxAgeGapYears: 2 },
    ] } });
    expect(fairnessLimitFor(6, 7, config(rules))).toEqual({ maxWeightGapLbs: 8 });
    expect(fairnessLimitFor(6, 9, config(rules))).toEqual({ maxWeightGapLbs: 8, maxAgeGapYears: 2 });
    expect(fairnessLimitFor(12, 14, config(rules))).toEqual({});
  });

  it('names the pair furthest apart when a division breaks a limit', () => {
    const rules = rulesWith({ fairness: { limits: [{ ageMin: 10, ageMax: 11, maxWeightGapLbs: 15, maxAgeGapYears: 0 }] } });
    const warnings = fairnessWarnings(
      {
        eventType: 'sparring',
        ageMin: 10,
        ageMax: 11,
        registrations: [
          reg('Ann', { weight: 62, age: 10, sparring: true }),
          reg('Cy', { weight: 70, age: 10, sparring: true }),
          reg('Ben', { weight: 85.5, age: 11, sparring: true }),
        ],
      },
      config(rules),
    );
    expect(warnings).toContain(
      'Weight gap over the limit: Ann Test (62 lb) and Ben Test (85.5 lb) are 23.5 lb apart (limit 15 lb) (1 more pair over the limit)',
    );
    expect(warnings.some((w) => w.startsWith('Age gap over the limit: Ann Test (10) and Ben Test (11)'))).toBe(true);
  });

  it('shows limit warnings in the preview', () => {
    const preview = previewCategorization(
      [reg('a', { age: 10 }), reg('b', { age: 10 }), reg('c', { age: 11 })],
      config(rulesWith({ fairness: { limits: [{ ageMin: 10, ageMax: 11, maxAgeGapYears: 0 }] } })),
    );
    expect(preview.warnings.some((w) =>
      w.includes(': Age gap over the limit: a Test (10) and c Test (11) are 1 year apart (limit 0 years) (1 more pair over the limit)'))).toBe(true);
  });

  it('blocks a merge that breaks a limit and says why', () => {
    const regs = [reg('six', { age: 6 }), reg('nine', { age: 9 })];
    const merging = { enableSmartMerging: true, minDivisionSize: 2 };
    const merged = previewCategorization(regs, config(rulesWith(), merging));
    expect(merged.divisions).toHaveLength(1);

    const blocked = previewCategorization(
      regs,
      config(rulesWith({ fairness: { limits: [{ ageMin: 4, ageMax: 99, maxAgeGapYears: 2 }] } }), merging),
    );
    expect(blocked.divisions).toHaveLength(2);
    expect(blocked.warnings.some((w) => w.startsWith('Kept "6-7') && w.includes('six Test (6) and nine Test (9) are 3 years apart'))).toBe(true);
  });

  it('still merges when the merged division stays within the limits', () => {
    const regs = [reg('seven', { age: 7 }), reg('eight', { age: 8 })];
    const preview = previewCategorization(
      regs,
      config(rulesWith({ fairness: { limits: [{ ageMin: 4, ageMax: 99, maxAgeGapYears: 2 }] } }), { enableSmartMerging: true, minDivisionSize: 2 }),
    );
    expect(preview.divisions).toHaveLength(1);
  });
});

describe('separate black belt age bands', () => {
  it('uses the black belt bands only for black belts', () => {
    const regs = [reg('bb13', { age: 13, belt: 'Black' }), reg('cb13', { age: 13, belt: 'Yellow' })];
    const preview = previewCategorization(regs, config(rulesWith({ ageBands: { blackBeltBands: BB_AGE_GROUPS } })));
    const bb = preview.divisions.find((d) => d.beltLevel === 'BB')!;
    const cb = preview.divisions.find((d) => d.beltLevel === 'CB')!;
    expect([bb.ageMin, bb.ageMax]).toEqual([12, 13]);
    expect([cb.ageMin, cb.ageMax]).toEqual([12, 14]);
  });

  it('leaves black belts on the shared bands when unset', () => {
    const preview = previewCategorization([reg('bb13', { age: 13, belt: 'Black' })], config(rulesWith()));
    expect([preview.divisions[0].ageMin, preview.divisions[0].ageMax]).toEqual([12, 14]);
  });
});

describe('school aliases', () => {
  const regs = [
    reg('n1', { school: 'Newtons TKD' }),
    reg('n2', { school: "newton's tkd" }),
    reg('n3', { school: 'Newtons TKD (Markham)' }),
    reg('o1', { school: 'Other Dojang' }),
  ];

  it('warns when one school fills most of a division, counting aliases', () => {
    const withAlias = previewCategorization(regs, config(rulesWith({ fairness: {
      schoolShareWarningPercent: 60,
      schoolAliases: [{ alias: 'Newtons TKD (Markham)', school: 'Newtons TKD' }],
    } })));
    expect(withAlias.warnings.some((w) => w.endsWith('3 of 4 competitors are from Newtons TKD'))).toBe(true);

    const noAlias = previewCategorization(regs, config(rulesWith({ fairness: { schoolShareWarningPercent: 60 } })));
    expect(noAlias.warnings.some((w) => w.includes('competitors are from'))).toBe(false);
  });

  it('does not warn by default', () => {
    const preview = previewCategorization(regs, config(rulesWith()));
    expect(preview.warnings.some((w) => w.includes('competitors are from'))).toBe(false);
  });

  it('spreads spellings of one school across a skill-balanced split', () => {
    const split = previewCategorization(
      [
        reg('a1', { school: 'Alpha TKD' }),
        reg('a2', { school: 'alpha t.k.d.' }),
        reg('b1', { school: 'Beta' }),
        reg('b2', { school: 'BETA' }),
      ],
      config(rulesWith(), { divisionThreshold: 2, enableSmartSplitting: true }),
    );
    expect(split.divisions).toHaveLength(2);
    for (const division of split.divisions) {
      const ids = idsIn(division);
      expect(ids.filter((id) => id.startsWith('a'))).toHaveLength(1);
    }
  });
});

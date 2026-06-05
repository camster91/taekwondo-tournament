// Tournament Rules — the single source of truth for how a real manager
// configures a tournament's categorization, bracket generation, and merging.
//
// Stored as JSON on Tournament.settings.rules. Defaults match the actual
// workflow used in the 2025 Newton's Championship .xlsm (33 schools, 1,248
// competitors, 8 age bands, 2 tiers, 4 weight classes per age band).

import type { AgeGroup } from './age-groups.js';
import { DEFAULT_AGE_GROUPS, BB_AGE_GROUPS } from './age-groups.js';
import { DEFAULT_WEIGHT_CLASSES, type WeightClassConfig } from './weight-classes.js';

// ─── Belt group definitions ──────────────────────────────────────────────
// A "belt group" is the bucket a belt color falls into for division purposes.
// The Newton's Championship uses 2 groups (CB / BB). Some tournaments use 3
// (CB / Poom / BB) or 4 (Beginner CB / Advanced CB / Poom / BB).
export interface BeltGroup {
  id: string;          // e.g. "CB", "BB", "POOM"
  label: string;       // e.g. "Colored Belt", "Black Belt", "Poom Belt"
  belts: string[];     // belt color names that fall in this group
  danMin?: number;     // for BB: include this Dan range
  danMax?: number;
  minAge?: number;     // e.g. Poom belts only apply under age 16
  maxAge?: number;
}

export const DEFAULT_BELT_GROUPS: BeltGroup[] = [
  {
    id: 'CB',
    label: 'Colored Belt',
    belts: [
      'White', 'White / Single Yellow Stripe', 'White / Double Yellow Stripe',
      'Yellow', 'Yellow / Single Green Stripe', 'Yellow / Double Green Stripe',
      'Green', 'Green / Single Blue Stripe', 'Green / Double Blue Stripe',
      'Blue', 'Blue / Single Red Stripe', 'Blue / Double Red Stripe',
      'Red', 'Red / Single Black Stripe', 'Red / Double Black Stripe',
    ],
  },
  {
    id: 'BB',
    label: 'Black Belt',
    belts: ['Black'],
    danMin: 1,
    danMax: 6,
  },
];

// ─── Age band strategy ──────────────────────────────────────────────────
// "By age band" = group kids into multi-year bands (4-5, 6-7, 8-9, ...).
// "By year" = every age is its own division (4, 5, 6, ...).
// "Custom" = manager defines exact age ranges.
export type AgeBandStrategy = 'byBand' | 'byYear' | 'custom';

export interface AgeBandConfig {
  strategy: AgeBandStrategy;
  // For strategy === 'byBand' / 'byYear': which preset
  preset?: 'standard' | 'blackBelt';
  // For strategy === 'custom' or to override a preset
  customBands?: AgeGroup[];
  // For 'byYear' mode: minimum 2 competitors in the same age before
  // they get their own division, otherwise they merge with adjacent age.
  yearMinDivisionSize?: number;
}

export const DEFAULT_AGE_BAND_CONFIG: AgeBandConfig = {
  strategy: 'byBand',
  preset: 'standard',
};

// ─── Weight class strategy ──────────────────────────────────────────────
// "Standard" = use the 4-class light/middle/heavy (or feather/light/middle/heavy) split.
// "Auto" = compute weight classes dynamically from competitor distribution.
// "Custom" = manager defines each weight class explicitly.
export type WeightStrategy = 'standard' | 'auto' | 'custom';

export interface WeightClassRuleConfig {
  strategy: WeightStrategy;
  // For 'standard' strategy: how many classes (3 or 4)
  // 3 = Light/Middle/Heavy, 4 = Feather/Light/Middle/Heavy
  classes?: 3 | 4;
  // For 'auto' strategy: how many competitors to target per class
  targetClassSize?: number;
  // For 'custom' strategy: explicit list
  customClasses?: WeightClassConfig[];
  // For very small divisions (4 or fewer), skip weight classing entirely
  skipIfDivisionSmallerThan?: number;
}

export const DEFAULT_WEIGHT_CONFIG: WeightClassRuleConfig = {
  strategy: 'standard',
  classes: 3,
  skipIfDivisionSmallerThan: 4,
};

// ─── Division split & merge rules ───────────────────────────────────────
export interface DivisionRules {
  // Min size for a division to stand on its own.
  // Smaller divisions get merged with the next adjacent division.
  minDivisionSize: number;
  // Max size before a division is forcibly split.
  maxDivisionSize: number;
  // When merging small divisions, prefer to merge:
  // 'ageUp'    = with the next age band up
  // 'ageDown'  = with the next age band down
  // 'weightAdj' = with the adjacent weight class (same age)
  // 'beltAdj'  = with the adjacent belt group (same age)
  mergeDirection: 'ageUp' | 'ageDown' | 'weightAdj' | 'beltAdj';
  // Allow age boundary flexibility: a competitor near the age boundary
  // (within `ageFlexMonths` of the next band) can be promoted up.
  ageFlexMonths: number;
  // When splitting large divisions, prefer to split by:
  // 'age' (each year its own), 'weight' (by weight class), 'belt' (by belt), 'school' (avoid same-school)
  splitBy: 'age' | 'weight' | 'belt' | 'school';
  // If true: a 1-person division is auto-merged with the next non-empty
  // division, even if it crosses a tier boundary (rare, for very small tournaments)
  allowCrossTierMerge: boolean;
}

export const DEFAULT_DIVISION_RULES: DivisionRules = {
  minDivisionSize: 2,
  maxDivisionSize: 16,
  mergeDirection: 'ageUp',
  ageFlexMonths: 6,
  splitBy: 'weight',
  allowCrossTierMerge: false,
};

// ─── Bracket rules ──────────────────────────────────────────────────────
export interface BracketRules {
  // Avoid same-school matchups in round 1 where possible
  // (only feasible for divisions with 8+ competitors)
  avoidSameSchoolRound1: boolean;
  // Seed by: 'rating' (ELO), 'experience' (years training), 'belt' (rank), 'random'
  seedingStrategy: 'rating' | 'experience' | 'belt' | 'random';
  // Number of consolation rounds in double-elim (1, 2, or 3)
  // 1 = standard, 2 = extra consolation for early losers, 3 = full
  consolationRounds: 1 | 2 | 3;
  // When the bracket is unbalanced (e.g. 5 competitors in an 8-slot bracket),
  // how to handle the byes:
  // 'top' = first slots get byes, 'random' = shuffle, 'rating' = top seeds get byes
  byePlacement: 'top' | 'random' | 'rating';
  // Round 1 pairing for odd-sized brackets:
  // 'adjacent' = seed 1 vs 2, 3 vs 4, ...  (strong vs strong early)
  // 'balanced' = seed 1 vs last, 2 vs second-last, ... (strong vs weak early)
  // 'split' = alternate from both ends
  round1Pairing: 'adjacent' | 'balanced' | 'split';
}

export const DEFAULT_BRACKET_RULES: BracketRules = {
  avoidSameSchoolRound1: true,
  seedingStrategy: 'rating',
  consolationRounds: 1,
  byePlacement: 'rating',
  round1Pairing: 'split',
};

// ─── Event rules ────────────────────────────────────────────────────────
export interface EventRules {
  patterns: {
    enabled: boolean;
    // Auto-categorize competitors by (tier, gender, age, belt)
    groupBy: ('tier' | 'gender' | 'age' | 'belt')[];
    // For belt splits: how many belts per division (e.g. 3 belts per division)
    beltsPerDivision?: number;
    // For age splits: same as division.minDivisionSize
    mergeUnder?: number;
  };
  sparring: {
    enabled: boolean;
    groupBy: ('tier' | 'gender' | 'age' | 'weight' | 'belt')[];
    // Override divisionRules for sparring (since weight is more important than age)
    weightStrategy: WeightStrategy;
    // For weight auto-strategy: how many competitors to target per class
    targetClassSize?: number;
  };
}

export const DEFAULT_EVENT_RULES: EventRules = {
  patterns: {
    enabled: true,
    groupBy: ['tier', 'gender', 'age', 'belt'],
    beltsPerDivision: 3,
  },
  sparring: {
    enabled: true,
    groupBy: ['tier', 'gender', 'age', 'weight'],
    weightStrategy: 'standard',
  },
};

// ─── Master rules object ────────────────────────────────────────────────
export interface TournamentRules {
  version: number;            // schema version, bump when shape changes
  beltGroups: BeltGroup[];
  ageBands: AgeBandConfig;
  weights: WeightClassRuleConfig;
  divisions: DivisionRules;
  brackets: BracketRules;
  events: EventRules;
  // Per-event, per-tier overrides
  // e.g. overrides: { sparring: { BB: { minDivisionSize: 3 } } }
  overrides?: Record<string, Record<string, Partial<DivisionRules>>>;
}

export const DEFAULT_TOURNAMENT_RULES: TournamentRules = {
  version: 1,
  beltGroups: DEFAULT_BELT_GROUPS,
  ageBands: DEFAULT_AGE_BAND_CONFIG,
  weights: DEFAULT_WEIGHT_CONFIG,
  divisions: DEFAULT_DIVISION_RULES,
  brackets: DEFAULT_BRACKET_RULES,
  events: DEFAULT_EVENT_RULES,
};

// ─── Type-safe accessors ────────────────────────────────────────────────
export function parseTournamentRules(json: string | null | undefined): TournamentRules {
  if (!json) return DEFAULT_TOURNAMENT_RULES;
  try {
    const parsed = JSON.parse(json);
    // Shallow-merge with defaults to handle schema additions gracefully
    return {
      ...DEFAULT_TOURNAMENT_RULES,
      ...parsed,
      beltGroups: parsed.beltGroups ?? DEFAULT_BELT_GROUPS,
      ageBands: { ...DEFAULT_AGE_BAND_CONFIG, ...parsed.ageBands },
      weights: { ...DEFAULT_WEIGHT_CONFIG, ...parsed.weights },
      divisions: { ...DEFAULT_DIVISION_RULES, ...parsed.divisions },
      brackets: { ...DEFAULT_BRACKET_RULES, ...parsed.brackets },
      events: {
        patterns: { ...DEFAULT_EVENT_RULES.patterns, ...parsed.events?.patterns },
        sparring: { ...DEFAULT_EVENT_RULES.sparring, ...parsed.events?.sparring },
      },
    };
  } catch {
    return DEFAULT_TOURNAMENT_RULES;
  }
}

export function serializeTournamentRules(rules: TournamentRules): string {
  return JSON.stringify({ ...rules, version: 1 });
}

// ─── Helpers ────────────────────────────────────────────────────────────
export function getBeltGroup(belt: string, danRank: number | null, rules: TournamentRules): BeltGroup | null {
  for (const g of rules.beltGroups) {
    if (!g.belts.includes(belt)) continue;
    if (g.danMin !== undefined && (danRank ?? 0) < g.danMin) continue;
    if (g.danMax !== undefined && (danRank ?? 0) > g.danMax) continue;
    return g;
  }
  return null;
}

export function getAgeBands(rules: TournamentRules): AgeGroup[] {
  const cfg = rules.ageBands;
  if (cfg.strategy === 'custom' && cfg.customBands) return cfg.customBands;
  if (cfg.strategy === 'byYear') {
    // Expand DEFAULT_AGE_GROUPS into 1-year bands
    return DEFAULT_AGE_GROUPS.flatMap((g) =>
      Array.from({ length: g.max - g.min + 1 }, (_, i) => ({
        min: g.min + i,
        max: g.min + i,
        label: String(g.min + i),
      }))
    );
  }
  // byBand with preset
  if (cfg.preset === 'blackBelt') return BB_AGE_GROUPS;
  return DEFAULT_AGE_GROUPS;
}

export function getEffectiveAgeBand(age: number, rules: TournamentRules): AgeGroup | null {
  const bands = getAgeBands(rules);
  return bands.find((b) => age >= b.min && age <= b.max) ?? null;
}

export function getWeightClasses(rules: TournamentRules): WeightClassConfig[] {
  if (rules.weights.strategy === 'custom' && rules.weights.customClasses) {
    return rules.weights.customClasses;
  }
  return DEFAULT_WEIGHT_CLASSES;
}

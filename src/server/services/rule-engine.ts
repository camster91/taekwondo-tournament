/**
 * Tournament Rule Engine
 *
 * Evaluates structured rules deterministically. Rules are stored as JSON
 * configurations and evaluated by type-specific handlers.
 *
 * Design principle: LLM configures rules -> Human approves -> Engine enforces deterministically
 */

import { PrismaClient } from '@prisma/client';
import { getAgeGroup } from '../../shared/constants/age-groups.js';

// Rule parameter types for each rule type
export interface SameSchoolAvoidanceParams {
  scope: 'first_round' | 'first_two_rounds' | 'all_rounds';
  minRoundsApart: number; // Minimum rounds before same-school can meet
  exceptions: string[]; // School names exempt (e.g., very large schools)
}

export interface WeightToleranceParams {
  maxDifferenceLbs: number;
  ageGroupOverrides?: Record<string, number>; // e.g., {"4-5": 5, "18-35": 25}
  checkInVerification: boolean; // Re-verify at check-in
  allowDivisionChange: boolean; // Auto-move if check-in weight differs
}

export interface HeightLimitParams {
  maxDifferenceInches: number;
  ageGroupOverrides?: Record<string, number>;
  applyToSparringOnly: boolean;
}

export interface ExperienceGroupingParams {
  separateNovice: boolean; // Keep first-time competitors separate
  noviceThreshold: number; // Max tournaments to be considered novice
  separateVeteran: boolean;
  veteranThreshold: number; // Min tournaments to be considered veteran
}

export interface MinDivisionSizeParams {
  minCompetitors: number;
  mergeStrategy: 'adjacent_age' | 'adjacent_belt' | 'closest_skill' | 'none';
  maxCompetitors: number;
  splitStrategy: 'skill_balanced' | 'random' | 'school_balanced';
}

export interface CustomConstraintParams {
  field: string; // "schoolDojang", "belt", "weightLbs", "ageAtTournament", etc.
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'between' | 'in' | 'not_in';
  value: string | number | string[] | number[];
  action: 'separate_divisions' | 'same_division' | 'warn' | 'block_registration';
  description: string;
}

export type RuleParameters =
  | SameSchoolAvoidanceParams
  | WeightToleranceParams
  | HeightLimitParams
  | ExperienceGroupingParams
  | MinDivisionSizeParams
  | CustomConstraintParams;

/**
 * Penalty per enforcement level when computing the fairness score.
 * Each hard violation costs 5 points, each soft warning 2 points,
 * info items are advisory and don't affect the score (they're still
 * returned in `result.info` for surfacing in the UI). Result is
 * clamped 0–100.
 *
 * Previous formula used `totalViolations / (entities * rules)` as a
 * fraction-of-possible-violations denominator, which collapsed to ~100
 * for realistic tournament sizes because the denominator grew with the
 * number of configured rules but the numerator was bounded by the
 * actual violation count. Two hard violations in a 100-match × 5-rule
 * tournament returned score 100 with passed: false — a contradictory
 * signal the evaluator reported in the 2026-07-09 audit.
 */
const HARD_VIOLATION_PENALTY = 5;
const SOFT_WARNING_PENALTY = 2;

export function computeFairnessScore(counts: { violations: number; warnings: number }): number {
  const raw = 100
    - HARD_VIOLATION_PENALTY * counts.violations
    - SOFT_WARNING_PENALTY * counts.warnings;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export interface TournamentRule {
  id: string;
  tournamentId: string;
  name: string;
  description: string | null;
  category: string;
  ruleType: string;
  enforcement: EnforcementLevel;
  parameters: RuleParameters;
  priority: number;
  isActive: boolean;
  source: string;
}

export type EnforcementLevel = 'hard' | 'soft' | 'info';

/**
 * Coerce a raw `enforcement` value from the DB to the validated union.
 * Unknown / empty values fall back to `info` so a hard rule can't be
 * silently downgraded to nothing by a manual SQL edit. The caller logs
 * the original value so the mismatch is visible in server logs.
 *
 * Note: createRuleSchema + updateRuleSchema already enforce the union
 * via zod, so this is purely a defense-in-depth check for old rows.
 */
function coerceEnforcement(raw: string, ruleId: string, ruleName: string): EnforcementLevel {
  if (raw === 'hard' || raw === 'soft' || raw === 'info') return raw;
  console.warn(
    `[rule-engine] rule ${ruleId} ("${ruleName}") has unrecognized enforcement "${raw}"; coercing to "info"`
  );
  return 'info';
}

/**
 * Resolve the effective per-match tolerance for a weight/height rule
 * that ships per-age-group overrides. The stricter (smaller) of the
 * two competitors' applicable overrides wins — protects kids from being
 * paired against a heavier/larger opponent just because they're in the
 * same division.
 *
 * Defaults to the rule's base limit when no override is configured,
 * when either age is missing, or when either competitor doesn't fit a
 * known age group.
 */
function resolveAgeGroupOverride(
  baseLimit: number,
  ageGroupOverrides: Record<string, number> | undefined,
  competitorAges: Array<number | null | undefined>
): number {
  if (!ageGroupOverrides) return baseLimit;
  const applicable: number[] = [];
  for (const age of competitorAges) {
    if (age == null) {
      applicable.push(baseLimit);
      continue;
    }
    const group = getAgeGroup(age);
    if (group && ageGroupOverrides[group.label] !== undefined) {
      applicable.push(ageGroupOverrides[group.label]);
    } else {
      applicable.push(baseLimit);
    }
  }
  return applicable.length === 0 ? baseLimit : Math.min(...applicable);
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  enforcement: 'hard' | 'soft' | 'info';
  description: string;
  affectedCompetitors: string[]; // competitor IDs
  affectedDivision?: string;
  affectedMatch?: string;
  suggestion?: string;
  severity: number; // 0-100
}

export interface RuleEvaluationResult {
  passed: boolean;
  violations: RuleViolation[];
  warnings: RuleViolation[];
  info: RuleViolation[];
  score: number; // Overall fairness score 0-100
}

/**
 * Load active rules for a tournament, parsed and sorted by priority.
 *
 * Corrupt or malformed `parameters` JSON (manual SQL edit, half-applied
 * migration) is logged and skipped — one bad row never 500s the whole
 * tournament's evaluation report.
 */
export async function loadTournamentRules(prisma: PrismaClient, tournamentId: string): Promise<TournamentRule[]> {
  const rawRules = await prisma.tournamentRule.findMany({
    where: { tournamentId, isActive: true },
    orderBy: { priority: 'desc' },
  });

  const parsed: TournamentRule[] = [];
  for (const rule of rawRules) {
    try {
      parsed.push({
        ...rule,
        parameters: JSON.parse(rule.parameters) as RuleParameters,
        enforcement: coerceEnforcement(rule.enforcement, rule.id, rule.name),
      });
    } catch (err) {
      console.warn(`[rule-engine] skipping rule ${rule.id} ("${rule.name}"): parameters is not valid JSON`);
    }
  }
  return parsed;
}

/**
 * Evaluate a bracket assignment against all active rules
 */
export function evaluateBracketRules(
  rules: TournamentRule[],
  matches: Array<{
    id: string;
    roundNumber: number;
    matchNumber: number;
    competitor1?: {
      id: string;
      competitorId: string;
      ageAtTournament?: number | null;
      competitor: { schoolDojang?: string | null; weightLbs?: number | null; heightInches?: number | null };
    } | null;
    competitor2?: {
      id: string;
      competitorId: string;
      ageAtTournament?: number | null;
      competitor: { schoolDojang?: string | null; weightLbs?: number | null; heightInches?: number | null };
    } | null;
  }>
): RuleEvaluationResult {
  const violations: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  const info: RuleViolation[] = [];

  for (const rule of rules.filter(r => r.category === 'bracket' || r.category === 'seeding')) {
    switch (rule.ruleType) {
      case 'same_school_avoidance': {
        const params = rule.parameters as SameSchoolAvoidanceParams;
        for (const match of matches) {
          if (!match.competitor1 || !match.competitor2) continue;
          const school1 = match.competitor1.competitor.schoolDojang;
          const school2 = match.competitor2.competitor.schoolDojang;
          if (school1 && school2 && school1 === school2) {
            const maxRound = params.scope === 'first_round' ? 1 : params.scope === 'first_two_rounds' ? 2 : Infinity;
            if (match.roundNumber <= maxRound) {
              if (params.exceptions.includes(school1)) continue;
              const violation: RuleViolation = {
                ruleId: rule.id,
                ruleName: rule.name,
                ruleType: rule.ruleType,
                enforcement: rule.enforcement,
                description: `Same-school matchup in round ${match.roundNumber}: both from "${school1}"`,
                affectedCompetitors: [match.competitor1.competitorId, match.competitor2.competitorId],
                affectedMatch: match.id,
                suggestion: 'Swap one competitor with an adjacent match to avoid same-school pairing',
                severity: match.roundNumber === 1 ? 90 : 70,
              };
              if (rule.enforcement === 'hard') violations.push(violation);
              else if (rule.enforcement === 'soft') warnings.push(violation);
              else info.push(violation);
            }
          }
        }
        break;
      }
      case 'weight_tolerance': {
        const params = rule.parameters as WeightToleranceParams;
        for (const match of matches) {
          if (!match.competitor1 || !match.competitor2) continue;
          const w1 = match.competitor1.competitor.weightLbs;
          const w2 = match.competitor2.competitor.weightLbs;
          if (w1 != null && w2 != null) {
            const diff = Math.abs(w1 - w2);
            const limit = resolveAgeGroupOverride(
              params.maxDifferenceLbs,
              params.ageGroupOverrides,
              [match.competitor1.ageAtTournament, match.competitor2.ageAtTournament]
            );
            if (diff > limit) {
              const violation: RuleViolation = {
                ruleId: rule.id,
                ruleName: rule.name,
                ruleType: rule.ruleType,
                enforcement: rule.enforcement,
                description: `Weight difference of ${diff.toFixed(1)} lbs exceeds ${limit} lb limit`,
                affectedCompetitors: [match.competitor1.competitorId, match.competitor2.competitorId],
                affectedMatch: match.id,
                suggestion: 'Consider moving the heavier competitor to a higher weight division',
                severity: Math.min(100, (diff / limit) * 80),
              };
              if (rule.enforcement === 'hard') violations.push(violation);
              else if (rule.enforcement === 'soft') warnings.push(violation);
              else info.push(violation);
            }
          }
        }
        break;
      }
      case 'height_limit': {
        const params = rule.parameters as HeightLimitParams;
        for (const match of matches) {
          if (!match.competitor1 || !match.competitor2) continue;
          const h1 = match.competitor1.competitor.heightInches;
          const h2 = match.competitor2.competitor.heightInches;
          if (h1 != null && h2 != null) {
            const diff = Math.abs(h1 - h2);
            const limit = resolveAgeGroupOverride(
              params.maxDifferenceInches,
              params.ageGroupOverrides,
              [match.competitor1.ageAtTournament, match.competitor2.ageAtTournament]
            );
            if (diff > limit) {
              const violation: RuleViolation = {
                ruleId: rule.id,
                ruleName: rule.name,
                ruleType: rule.ruleType,
                enforcement: rule.enforcement,
                description: `Height difference of ${diff.toFixed(1)} inches exceeds ${limit} inch limit`,
                affectedCompetitors: [match.competitor1.competitorId, match.competitor2.competitorId],
                affectedMatch: match.id,
                suggestion: 'Review matchup — significant height advantage may be unfair',
                severity: Math.min(100, (diff / limit) * 70),
              };
              if (rule.enforcement === 'hard') violations.push(violation);
              else if (rule.enforcement === 'soft') warnings.push(violation);
              else info.push(violation);
            }
          }
        }
        break;
      }
    }
  }

  const score = computeFairnessScore({ violations: violations.length, warnings: warnings.length });

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    info,
    score,
  };
}

/**
 * Evaluate division assignments against rules
 */
export function evaluateDivisionRules(
  rules: TournamentRule[],
  divisions: Array<{
    id: string;
    name: string;
    eventType: string;
    assignments: Array<{
      registration: {
        id: string;
        competitorId: string;
        ageAtTournament: number | null;
        weightAtRegistration: number | null;
        competitor: {
          schoolDojang: string | null;
          weightLbs: number | null;
          heightInches: number | null;
        };
      };
    }>;
  }>
): RuleEvaluationResult {
  const violations: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  const info: RuleViolation[] = [];

  for (const rule of rules.filter(r => r.category === 'division')) {
    switch (rule.ruleType) {
      case 'experience_grouping': {
        // Surfacing the not-yet-implemented state as a structured info
        // item keeps the rule visible in the evaluation report so a
        // director activating this rule sees an explicit "not enforced"
        // signal rather than a silent green light.
        info.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          enforcement: 'info',
          description: 'experience_grouping enforcement is not yet implemented; this rule is informational only',
          affectedCompetitors: [],
          severity: 0,
        });
        break;
      }
      case 'min_division_size': {
        const params = rule.parameters as MinDivisionSizeParams;
        for (const div of divisions) {
          const size = div.assignments.length;
          if (size < params.minCompetitors && size > 0) {
            const violation: RuleViolation = {
              ruleId: rule.id,
              ruleName: rule.name,
              ruleType: rule.ruleType,
              enforcement: rule.enforcement,
              description: `Division "${div.name}" has only ${size} competitor(s), below minimum of ${params.minCompetitors}`,
              affectedCompetitors: div.assignments.map(a => a.registration.competitorId),
              affectedDivision: div.id,
              suggestion: `Merge with an adjacent division using ${params.mergeStrategy} strategy`,
              severity: size === 1 ? 90 : 60,
            };
            if (rule.enforcement === 'hard') violations.push(violation);
            else if (rule.enforcement === 'soft') warnings.push(violation);
            else info.push(violation);
          }
          if (size > params.maxCompetitors) {
            const violation: RuleViolation = {
              ruleId: rule.id,
              ruleName: rule.name,
              ruleType: rule.ruleType,
              enforcement: rule.enforcement,
              description: `Division "${div.name}" has ${size} competitors, exceeding maximum of ${params.maxCompetitors}`,
              affectedCompetitors: div.assignments.map(a => a.registration.competitorId),
              affectedDivision: div.id,
              suggestion: `Split into ${Math.ceil(size / params.maxCompetitors)} divisions using ${params.splitStrategy} strategy`,
              severity: 70,
            };
            if (rule.enforcement === 'hard') violations.push(violation);
            else if (rule.enforcement === 'soft') warnings.push(violation);
            else info.push(violation);
          }
        }
        break;
      }
    }
  }

  const score = computeFairnessScore({ violations: violations.length, warnings: warnings.length });

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    info,
    score,
  };
}

/**
 * Get default rules for a new tournament
 */
export function getDefaultRules(tournamentId: string): Array<Omit<TournamentRule, 'id' | 'parameters'> & { parameters: string }> {
  return [
    {
      tournamentId,
      name: 'Same-school first-round avoidance',
      description: 'Competitors from the same school should not face each other in the first round when avoidable',
      category: 'bracket',
      ruleType: 'same_school_avoidance',
      enforcement: 'soft',
      parameters: JSON.stringify({
        scope: 'first_round',
        minRoundsApart: 1,
        exceptions: [],
      } satisfies SameSchoolAvoidanceParams),
      priority: 80,
      isActive: true,
      source: 'system_default',
    },
    {
      tournamentId,
      name: 'Sparring weight tolerance',
      description: 'Maximum weight difference between sparring opponents',
      category: 'bracket',
      ruleType: 'weight_tolerance',
      enforcement: 'soft',
      parameters: JSON.stringify({
        maxDifferenceLbs: 20,
        ageGroupOverrides: { '4-5': 5, '6-7': 8, '8-9': 10, '10-11': 12, '12-14': 15, '15-17': 20, '18-35': 25, '36+': 25 },
        checkInVerification: true,
        allowDivisionChange: false,
      } satisfies WeightToleranceParams),
      priority: 90,
      isActive: true,
      source: 'system_default',
    },
    {
      tournamentId,
      name: 'Sparring height limit',
      description: 'Maximum height difference between sparring opponents',
      category: 'bracket',
      ruleType: 'height_limit',
      enforcement: 'info',
      parameters: JSON.stringify({
        maxDifferenceInches: 6,
        ageGroupOverrides: { '4-5': 3, '6-7': 4, '8-9': 5 },
        applyToSparringOnly: true,
      } satisfies HeightLimitParams),
      priority: 70,
      isActive: true,
      source: 'system_default',
    },
    {
      tournamentId,
      name: 'Division size limits',
      description: 'Minimum and maximum competitors per division',
      category: 'division',
      ruleType: 'min_division_size',
      enforcement: 'soft',
      parameters: JSON.stringify({
        minCompetitors: 3,
        mergeStrategy: 'adjacent_age',
        maxCompetitors: 16,
        splitStrategy: 'skill_balanced',
      } satisfies MinDivisionSizeParams),
      priority: 60,
      isActive: true,
      source: 'system_default',
    },
  ];
}

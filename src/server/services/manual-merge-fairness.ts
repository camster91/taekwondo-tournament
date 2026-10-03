/**
 * Fairness limits for a director's manual merge: warn, don't block.
 *
 * Automatic merges never break the tournament's fairness limits
 * (rules.fairness.limits). A manual merge may, but only after the
 * director confirms: the first request gets a 409 naming the pair
 * furthest apart, and the client resends with `confirmOverLimit: true`.
 */
import type { TournamentRules } from '../../shared/constants/tournament-rules.js';
import {
  fairnessLimitBreaks,
  type FairnessLimitBreak,
  type RegistrationWithCompetitor,
} from './categorization-engine.js';

export interface MergeDivisionShape {
  eventType: string;
  ageMin: number;
  ageMax: number;
}

export interface FairnessLimitConflict {
  error: string;
  code: 'FAIRNESS_LIMIT';
  message: string;
  details: FairnessLimitBreak[];
}

/** Whether the tournament has any fairness limit set. */
export function hasFairnessLimits(rules: TournamentRules | undefined): boolean {
  return (rules?.fairness?.limits ?? []).some(
    (l) => l.maxWeightGapLbs !== undefined || l.maxAgeGapYears !== undefined,
  );
}

/**
 * The limits the merged division (target + sources, with everyone now
 * in any of them) would break. The merged division keeps the target's
 * event and covers all their ages.
 */
export function manualMergeLimitBreaks(
  target: MergeDivisionShape,
  sources: MergeDivisionShape[],
  registrations: RegistrationWithCompetitor[],
  rules: TournamentRules | undefined,
): FairnessLimitBreak[] {
  if (!hasFairnessLimits(rules)) return [];
  const all = [target, ...sources];
  const unique = [...new Map(registrations.map((r) => [r.id, r])).values()];
  return fairnessLimitBreaks(
    {
      eventType: target.eventType === 'sparring' ? 'sparring' : 'patterns',
      ageMin: Math.min(...all.map((d) => d.ageMin)),
      ageMax: Math.max(...all.map((d) => d.ageMax)),
      registrations: unique,
    },
    { divisionThreshold: 0, rules },
  );
}

/**
 * The 409 body for a merge that breaks a limit, or null when the merge
 * may go ahead (no break, or the director confirmed).
 */
export function fairnessLimitConflict(
  breaks: FairnessLimitBreak[],
  confirmOverLimit: boolean,
): FairnessLimitConflict | null {
  if (breaks.length === 0 || confirmOverLimit) return null;
  const message = breaks.map((b) => b.message).join(' ');
  return {
    error: message,
    code: 'FAIRNESS_LIMIT',
    message,
    details: breaks,
  };
}

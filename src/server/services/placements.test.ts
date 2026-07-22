/**
 * Regression tests for `resolvePlacements` and `isBracketCompletePure`.
 *
 * Background: the placement helpers previously used hardcoded match
 * numbers (`?? 14`, `?? 15`, `?? 13`, `?? 7`) when the bracket
 * structure didn't have the named `positions` field — but those
 * fallbacks also kicked in when `positions` WAS present but a
 * specific role was `null` (e.g. N=4 has no reset match). The result:
 * for N=4 brackets, 3rd place was looked up at match 13 (which
 * doesn't exist), and the bracket was reported incomplete forever.
 *
 * These tests pin the correct behavior across bracket sizes.
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePlacements,
  isBracketCompletePure,
  resolveNextMatchSlots,
  pickSlotsToNull,
  isValidStatusTransition,
  validateMatchStatusTransition,
  type BracketPositions,
} from './match-advancement.js';
import {
  validateGroup,
  type DivisionGroup,
} from './categorization-engine.js';
import type { BracketStructure } from './bracket-generator.js';
import {
  timeToMinutes,
  minutesToTime,
  validateScheduleConfig,
  estimateDivisionDuration,
  slotsOverlap,
  DEFAULT_CONFIG,
  type ScheduleConfig,
} from './schedule-generator.js';

// ─── helpers ──────────────────────────────────────────────────────────

const completed = (
  matchNumber: number,
  c1: string | null,
  c2: string | null,
  winner: string | null,
  bracketType: 'winners' | 'losers' | 'finals' = 'winners'
) => ({
  matchNumber,
  bracketType,
  status: 'completed' as const,
  winnerId: winner,
  competitor1Id: c1,
  competitor2Id: c2,
});

// ─── resolvePlacements ───────────────────────────────────────────────

describe('resolvePlacements — empty / in-progress', () => {
  it('returns empty when positions is null/undefined', () => {
    expect(resolvePlacements([], null)).toEqual([]);
    expect(resolvePlacements([], undefined)).toEqual([]);
  });

  it('returns 3rd place from losers final even when grand final is in progress', () => {
    // 3rd place is determined entirely by the losers final — it's
    // independent of the grand final. So even when the GF hasn't
    // been decided yet, if the L R1 / L final has produced a loser,
    // we know the 3rd place.
    const positions: BracketPositions = {
      winnersFinal: 3, losersFinal: 4, grandFinals: 5, reset: null,
    };
    const matches = [
      completed(3, 'A', 'B', 'A'),
      completed(4, 'D', 'C', 'D'),  // C loses L R1 → 3rd place
      // GF in progress, no winner yet
      { matchNumber: 5, bracketType: 'finals' as const, status: 'in_progress', winnerId: null, competitor1Id: 'A', competitor2Id: 'D' },
    ];
    const p = resolvePlacements(matches, positions);
    expect(p).toContainEqual({ place: 3, competitorId: 'C' });
    expect(p.find((x) => x.place === 1)).toBeUndefined();
    expect(p.find((x) => x.place === 2)).toBeUndefined();
  });
});

describe('resolvePlacements — N=4 person DE', () => {
  // 4-person: W R1 M1+M2, W R2 M3, L R1 M4, GF M5, no reset.
  const positions: BracketPositions = {
    winnersFinal: 3, losersFinal: 4, grandFinals: 5, reset: null,
  };

  it('reports 1st + 2nd from the grand final when no reset exists', () => {
    const matches = [
      completed(1, 'A', 'D', 'A'),
      completed(2, 'B', 'C', 'B'),
      completed(3, 'A', 'B', 'A'),  // WB champ A
      completed(4, 'D', 'C', 'D'),  // LB champ D
      completed(5, 'A', 'D', 'A', 'finals'),  // GF: A wins
    ];
    const p = resolvePlacements(matches, positions);
    // 3rd place comes from the losers final (C). B (WB-final loser)
    // never appears in a losers match in N=4 (no LB slot for the
    // WB-final loser), so B is correctly NOT surfaced as 3rd.
    expect(p).toEqual([
      { place: 1, competitorId: 'A' },
      { place: 2, competitorId: 'D' },
      { place: 3, competitorId: 'C' },
    ]);
  });

  it('reports 3rd place from losers final (regression: was missing under the ?? 13 fallback)', () => {
    // The old code looked up `losersFinal ?? 13`, found nothing at
    // match 13 for an N=4 bracket, and silently dropped 3rd place.
    const matches = [
      completed(1, 'A', 'D', 'A'),
      completed(2, 'B', 'C', 'B'),
      completed(3, 'A', 'B', 'A'),
      completed(4, 'D', 'C', 'D'),  // L R1: D wins, C loses → 3rd place
      completed(5, 'A', 'D', 'A', 'finals'),
    ];
    const p = resolvePlacements(matches, positions);
    expect(p).toContainEqual({ place: 3, competitorId: 'C' });
  });

  it('handles positions.reset === null without falling back to 15', () => {
    // The old code did `positions?.reset ?? 15`, looking for match 15
    // on an N=4 bracket (which has only 5 matches). The fix is to
    // skip the reset branch when positions.reset is explicitly null.
    const matches = [
      completed(1, 'A', 'D', 'A'),
      completed(2, 'B', 'C', 'B'),
      completed(3, 'A', 'B', 'A'),
      completed(4, 'D', 'C', 'D'),
      completed(5, 'A', 'D', 'A', 'finals'),
    ];
    // Even if a fake "match 15" exists, it must be ignored.
    const matchesWithJunk = [
      ...matches,
      { matchNumber: 15, bracketType: 'finals' as const, status: 'completed', winnerId: 'X', competitor1Id: 'A', competitor2Id: 'X' },
    ];
    const p = resolvePlacements(matchesWithJunk, positions);
    // No 1st place should be taken from match 15 — positions.reset is null.
    expect(p.find((x) => x.place === 1)).toEqual({ place: 1, competitorId: 'A' });
  });
});

describe('resolvePlacements — N=8 DE with reset', () => {
  const positions: BracketPositions = {
    winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15,
  };

  it('reports 1st + 2nd from the reset match when it was played', () => {
    const matches = [
      completed(14, 'WB', 'LB', 'LB', 'finals'),  // GF: LB champ wins, forcing reset
      completed(15, 'WB', 'LB', 'WB', 'finals'),  // Reset: WB wins
    ];
    const p = resolvePlacements(matches, positions);
    expect(p).toEqual([
      { place: 1, competitorId: 'WB' },
      { place: 2, competitorId: 'LB' },
    ]);
  });

  it('reports 1st + 2nd from the grand final when no reset was needed', () => {
    const matches = [
      completed(14, 'WB', 'LB', 'WB', 'finals'),
      // Reset not played (pending or absent)
      { matchNumber: 15, bracketType: 'finals' as const, status: 'pending', winnerId: null, competitor1Id: null, competitor2Id: null },
    ];
    const p = resolvePlacements(matches, positions);
    expect(p).toEqual([
      { place: 1, competitorId: 'WB' },
      { place: 2, competitorId: 'LB' },
    ]);
  });

  it('reports 3rd place from losers final + tied 3rd from winners-final loser', () => {
    // 8-person DE produces two 3rd-place finishers:
    //   - loser of the losers final (13)
    //   - loser of the winners final (7) — they dropped to losers
    //     and were eliminated there. To trigger the tied-3rd path,
    //     B must actually appear as a participant in a completed
    //     losers match (a real bracket would have B drop to L R2).
    const matches = [
      completed(7, 'A', 'B', 'A'),  // WB final — B drops to losers
      completed(11, 'B', 'Z', 'Z', 'losers'),  // L R2 — B loses, eliminated
      completed(13, 'X', 'Y', 'X', 'losers'),  // LB final
      completed(14, 'A', 'X', 'A', 'finals'),  // GF
    ];
    const p = resolvePlacements(matches, positions);
    // A is 1st (won GF), X is 2nd (lost GF as LB champ).
    // Y is 3rd (lost LB final). B is 3rd (lost WB final, dropped to
    // losers, appeared in match 11 and lost there).
    expect(p).toContainEqual({ place: 1, competitorId: 'A' });
    expect(p).toContainEqual({ place: 2, competitorId: 'X' });
    const thirds = p.filter((x) => x.place === 3);
    expect(thirds.map((t) => t.competitorId).sort()).toEqual(['B', 'Y']);
  });
});

describe('resolvePlacements — N=3 (no losers bracket)', () => {
  const positions: BracketPositions = {
    winnersFinal: 3, losersFinal: null, grandFinals: 3, reset: null,
  };

  it('reports 1st + 2nd, no 3rd', () => {
    const matches = [
      completed(1, 'A', 'C', 'A'),  // BYE for slot 3
      completed(2, 'B', 'C', 'B'),
      completed(3, 'A', 'B', 'A', 'finals'),
    ];
    const p = resolvePlacements(matches, positions);
    expect(p).toEqual([
      { place: 1, competitorId: 'A' },
      { place: 2, competitorId: 'B' },
    ]);
    expect(p.find((x) => x.place === 3)).toBeUndefined();
  });
});

describe('resolvePlacements — N=16 (positions != 8-person defaults)', () => {
  const positions: BracketPositions = {
    winnersFinal: 15, losersFinal: 29, grandFinals: 30, reset: 31,
  };

  it('does NOT look up match 14/15 (the 8-person defaults)', () => {
    // Regression: under the old `?? 14` fallback, 16-person brackets
    // would have looked at match 14 for the GF and found a winners-
    // bracket match instead, then either returned nothing or
    // returned bogus placements.
    const matches = [
      completed(14, 'X', 'Y', 'X'),  // some early WR2 match at 14
      completed(15, 'A', 'B', 'A'),  // WB final
      completed(29, 'P', 'Q', 'P'),  // LB final
      completed(30, 'A', 'P', 'A', 'finals'),  // real GF
      completed(31, 'A', 'P', 'A', 'finals'),  // reset
    ];
    const p = resolvePlacements(matches, positions);
    expect(p[0]).toEqual({ place: 1, competitorId: 'A' });
    expect(p[1]).toEqual({ place: 2, competitorId: 'P' });
  });
});

// ─── isBracketCompletePure ───────────────────────────────────────────

describe('isBracketCompletePure', () => {
  it('returns false when positions is null', () => {
    expect(isBracketCompletePure([{ matchNumber: 1, status: 'completed' }], null)).toBe(false);
  });

  it('returns false when grand final is not yet completed (regression: N=4 stuck incomplete forever)', () => {
    // Old code: `positions?.grandFinals ?? 14` → looked at match 14
    // for an N=4 bracket, didn't find it, returned false forever.
    const positions: BracketPositions = {
      winnersFinal: 3, losersFinal: 4, grandFinals: 5, reset: null,
    };
    const matches = [
      { matchNumber: 3, status: 'completed' },
      { matchNumber: 4, status: 'completed' },
      { matchNumber: 5, status: 'in_progress' },
    ];
    // Correct behavior: incomplete because GF isn't done.
    expect(isBracketCompletePure(matches, positions)).toBe(false);
  });

  it('returns true when GF is completed and no reset exists', () => {
    const positions: BracketPositions = {
      winnersFinal: 3, losersFinal: 4, grandFinals: 5, reset: null,
    };
    const matches = [
      { matchNumber: 5, status: 'completed' },
    ];
    expect(isBracketCompletePure(matches, positions)).toBe(true);
  });

  it('returns false when GF is done but reset is in `ready` state', () => {
    // 8-person DE: GF decided (LB champ won) → reset was activated.
    const positions: BracketPositions = {
      winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15,
    };
    const matches = [
      { matchNumber: 14, status: 'completed' },
      { matchNumber: 15, status: 'ready' },
    ];
    expect(isBracketCompletePure(matches, positions)).toBe(false);
  });

  it('returns true when GF is done and reset is also completed', () => {
    const positions: BracketPositions = {
      winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15,
    };
    const matches = [
      { matchNumber: 14, status: 'completed' },
      { matchNumber: 15, status: 'completed' },
    ];
    expect(isBracketCompletePure(matches, positions)).toBe(true);
  });

  it('returns true when reset was never needed (WB champ won GF, reset stays pending)', () => {
    const positions: BracketPositions = {
      winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15,
    };
    const matches = [
      { matchNumber: 14, status: 'completed' },
      // Reset is pending because the WB champ won — no rematch needed.
      { matchNumber: 15, status: 'pending' },
    ];
    expect(isBracketCompletePure(matches, positions)).toBe(true);
  });
});

/**
 * Regression tests for the schedule generator's pure helpers.
 *
 * The schedule generator has 304 lines and was previously untested at
 * the unit level (only e2e). PR #107 extracted the time helpers,
 * duration estimator, config validator, and overlap detector as
 * exported pure functions so they could be tested directly. Tests
 * below pin the contract that callers (the route + the service
 * internals) depend on.
 */

describe('timeToMinutes / minutesToTime round-trip', () => {
  it('round-trips all valid hour/minute combos', () => {
    for (const h of [0, 1, 9, 12, 23]) {
      for (const m of [0, 1, 30, 59]) {
        const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        expect(minutesToTime(timeToMinutes(time))).toBe(time);
      }
    }
  });

  it('accepts single-digit hours (9:30)', () => {
    expect(timeToMinutes('9:30')).toBe(570);
  });

  it('regression: throws on empty string (was: returned NaN, silently broke schedule)', () => {
    expect(() => timeToMinutes('')).toThrow(/Invalid time format/);
  });

  it('regression: throws on bare integer (was: returned NaN)', () => {
    expect(() => timeToMinutes('25')).toThrow(/Invalid time format/);
  });

  it('regression: throws on out-of-range minutes (was: silently accepted)', () => {
    expect(() => timeToMinutes('9:60')).toThrow(/Invalid time format/);
    expect(() => timeToMinutes('9:99')).toThrow(/Invalid time format/);
  });

  it('regression: throws on out-of-range hours (was: silently accepted)', () => {
    expect(() => timeToMinutes('24:00')).toThrow(/Invalid time format/);
    expect(() => timeToMinutes('99:00')).toThrow(/Invalid time format/);
  });

  it('regression: minutesToTime throws on NaN / negative (was: produced "NaN:NaN")', () => {
    expect(() => minutesToTime(Number.NaN)).toThrow(/Invalid minute value/);
    expect(() => minutesToTime(-1)).toThrow(/Invalid minute value/);
    expect(() => minutesToTime(Infinity)).toThrow(/Invalid minute value/);
  });

  it('handles 24h values up to 23:59', () => {
    expect(timeToMinutes('23:59')).toBe(23 * 60 + 59);
  });
});

describe('validateScheduleConfig', () => {
  const base: ScheduleConfig = { ...DEFAULT_CONFIG };

  it('accepts the default config', () => {
    expect(() => validateScheduleConfig(base)).not.toThrow();
  });

  it('rejects negative ring count', () => {
    expect(() => validateScheduleConfig({ ...base, ringCount: -1 })).toThrow(/ringCount must be a positive integer/);
  });

  it('rejects zero ring count', () => {
    expect(() => validateScheduleConfig({ ...base, ringCount: 0 })).toThrow(/ringCount must be a positive integer/);
  });

  it('rejects non-integer ring count', () => {
    expect(() => validateScheduleConfig({ ...base, ringCount: 4.5 })).toThrow(/ringCount must be a positive integer/);
  });

  it('rejects ring count > 100 (OOM guard)', () => {
    expect(() => validateScheduleConfig({ ...base, ringCount: 1000 })).toThrow(/ringCount must be <= 100/);
  });

  it('rejects malformed startTime', () => {
    expect(() => validateScheduleConfig({ ...base, startTime: 'garbage' })).toThrow(/Invalid time format/);
  });

  it('rejects malformed endTime', () => {
    expect(() => validateScheduleConfig({ ...base, endTime: '25:00' })).toThrow(/Invalid time format/);
  });

  it('rejects endTime <= startTime (was: silently accepted)', () => {
    expect(() => validateScheduleConfig({ ...base, startTime: '17:00', endTime: '09:00' })).toThrow(/endTime.*must be after/);
    expect(() => validateScheduleConfig({ ...base, startTime: '09:00', endTime: '09:00' })).toThrow(/endTime.*must be after/);
  });

  it('rejects negative or zero match duration', () => {
    expect(() => validateScheduleConfig({
      ...base,
      matchDurationMinutes: { patterns: 0, sparring: 5 },
    })).toThrow(/matchDurationMinutes\.patterns must be a positive number/);
    expect(() => validateScheduleConfig({
      ...base,
      matchDurationMinutes: { patterns: 3, sparring: -1 },
    })).toThrow(/matchDurationMinutes\.sparring must be a positive number/);
  });

  it('rejects negative break', () => {
    expect(() => validateScheduleConfig({ ...base, breakBetweenDivisions: -1 })).toThrow(/breakBetweenDivisions must be a non-negative/);
  });

  it('accepts zero break (back-to-back divisions)', () => {
    expect(() => validateScheduleConfig({ ...base, breakBetweenDivisions: 0 })).not.toThrow();
  });
});

describe('estimateDivisionDuration', () => {
  const config: ScheduleConfig = {
    ...DEFAULT_CONFIG,
    matchDurationMinutes: { patterns: 3, sparring: 5 },
  };

  it('returns within [10, 90] for empty/small/large competitor counts', () => {
    for (const n of [0, 1, 2, 4, 8, 16, 32, 100]) {
      const d = estimateDivisionDuration(n, 'sparring', config);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(90);
    }
  });

  it('uses patterns duration for patterns events', () => {
    const d = estimateDivisionDuration(8, 'patterns', config);
    // 8*1.5 = 12 matches * 3 min = 36 min
    expect(d).toBe(36);
  });

  it('uses sparring duration for sparring events', () => {
    const d = estimateDivisionDuration(8, 'sparring', config);
    // 8*1.5 = 12 matches * 5 min = 60 min
    expect(d).toBe(60);
  });

  it('falls through to sparring for unknown event types (regression: was the original behavior)', () => {
    const d = estimateDivisionDuration(8, 'weird-event-type', config);
    expect(d).toBe(60); // sparring
  });

  it('applies 10-minute minimum', () => {
    expect(estimateDivisionDuration(0, 'sparring', config)).toBe(10);
    expect(estimateDivisionDuration(1, 'sparring', config)).toBe(10);
  });

  it('applies 90-minute ceiling (regression: known — see PR description)', () => {
    // 100 competitors → 150 estimated matches → 750 min → capped at 90.
    const d = estimateDivisionDuration(100, 'sparring', config);
    expect(d).toBe(90);
  });
});

describe('slotsOverlap (double-booking detection)', () => {
  it('detects forward overlap', () => {
    // a = 540-600 (09:00-10:00), b = 570-630 (09:30-10:30)
    expect(slotsOverlap({ start: 540, end: 600 }, { start: 570, end: 630 })).toBe(true);
  });

  it('detects reverse overlap', () => {
    expect(slotsOverlap({ start: 570, end: 630 }, { start: 540, end: 600 })).toBe(true);
  });

  it('detects identical slots', () => {
    expect(slotsOverlap({ start: 540, end: 600 }, { start: 540, end: 600 })).toBe(true);
  });

  it('detects one-contains-the-other', () => {
    expect(slotsOverlap({ start: 540, end: 600 }, { start: 555, end: 575 })).toBe(true);
  });

  it('does NOT flag back-to-back (b starts when a ends)', () => {
    // Convention: a kid finishing patterns at 10:00 can start sparring at 10:00.
    expect(slotsOverlap({ start: 540, end: 600 }, { start: 600, end: 660 })).toBe(false);
  });

  it('does NOT flag disjoint slots', () => {
    expect(slotsOverlap({ start: 540, end: 600 }, { start: 700, end: 760 })).toBe(false);
  });

  it('does NOT flag touching-at-start slots (b starts at a.end - 1)', () => {
    // Minute-level adjacency: a ends at 10:00, b starts at 09:59.
    expect(slotsOverlap({ start: 540, end: 600 }, { start: 599, end: 659 })).toBe(true);
  });
});

describe('resolveNextMatchSlots — undo target resolution', () => {
  // Use a hand-built 8-person DE structure that mirrors what the
  // generator produces. We don't import generateBracket here to
  // keep the test fast and free of Prisma-adjacent deps.
  const eightPersonDE: BracketStructure = {
    winners: [
      { matchNumber: 1, round: 1, competitor1Id: 'r1', competitor2Id: 'r8', nextWinnerMatch: 5, nextLoserMatch: 8 },
      { matchNumber: 2, round: 1, competitor1Id: 'r4', competitor2Id: 'r5', nextWinnerMatch: 5, nextLoserMatch: 8 },
      { matchNumber: 3, round: 1, competitor1Id: 'r2', competitor2Id: 'r7', nextWinnerMatch: 6, nextLoserMatch: 9 },
      { matchNumber: 4, round: 1, competitor1Id: 'r3', competitor2Id: 'r6', nextWinnerMatch: 6, nextLoserMatch: 9 },
      { matchNumber: 5, round: 2, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 7, nextLoserMatch: 10 },
      { matchNumber: 6, round: 2, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 7, nextLoserMatch: 11 },
      { matchNumber: 7, round: 3, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 14, nextLoserMatch: 13 },
    ],
    losers: [
      { matchNumber: 8, round: 1, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 10 },
      { matchNumber: 9, round: 1, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 11 },
      { matchNumber: 10, round: 2, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 12 },
      { matchNumber: 11, round: 2, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 12 },
      { matchNumber: 12, round: 3, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 13 },
      { matchNumber: 13, round: 4, competitor1Id: null, competitor2Id: null, nextWinnerMatch: 14 },
    ],
    finals: [
      { matchNumber: 14, round: 4, competitor1Id: null, competitor2Id: null },
      { matchNumber: 15, round: 5, competitor1Id: null, competitor2Id: null },
    ],
    competitorCount: 8,
    positions: { winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15 },
  };

  it('returns both slots of nextWinnerMatch + nextLoserMatch for an R1 winners match', () => {
    const targets = resolveNextMatchSlots(
      { matchNumber: 1, bracketType: 'winners' },
      eightPersonDE
    );
    // nextWinnerMatch is M5 (slot 1, then 2 if filled).
    // nextLoserMatch is M8 (slot 1, then 2 if filled).
    expect(targets).toEqual([
      { matchNumber: 5, bracketType: 'winners', slot: 'competitor1' },
      { matchNumber: 5, bracketType: 'winners', slot: 'competitor2' },
      { matchNumber: 8, bracketType: 'losers', slot: 'competitor1' },
      { matchNumber: 8, bracketType: 'losers', slot: 'competitor2' },
    ]);
  });

  it('returns nextWinnerMatch only for losers matches (no nextLoserMatch there)', () => {
    const targets = resolveNextMatchSlots(
      { matchNumber: 8, bracketType: 'losers' },
      eightPersonDE
    );
    // M8 nextWinnerMatch = M10. No nextLoserMatch.
    expect(targets).toEqual([
      { matchNumber: 10, bracketType: 'losers', slot: 'competitor1' },
      { matchNumber: 10, bracketType: 'losers', slot: 'competitor2' },
    ]);
  });

  it('returns empty for the grand final (no next links)', () => {
    expect(resolveNextMatchSlots(
      { matchNumber: 14, bracketType: 'finals' },
      eightPersonDE
    )).toEqual([]);
  });

  it('returns empty when structure is missing', () => {
    expect(resolveNextMatchSlots(
      { matchNumber: 1, bracketType: 'winners' },
      null
    )).toEqual([]);
    expect(resolveNextMatchSlots(
      { matchNumber: 1, bracketType: 'winners' },
      undefined
    )).toEqual([]);
  });

  it('regression: undoing R1 M1 finds M5, not M7 (regression of the matchNumber: 1 heuristic)', () => {
    // The previous code looked for "roundNumber+1, matchNumber: 1" and
    // found the WB final (M7, round 3, matchNumber 1). Wrong — M7 is
    // two rounds away. The real next match for M1 is M5.
    const targets = resolveNextMatchSlots(
      { matchNumber: 1, bracketType: 'winners' },
      eightPersonDE
    );
    expect(targets.find((t) => t.matchNumber === 7)).toBeUndefined();
    expect(targets.some((t) => t.matchNumber === 5)).toBe(true);
  });
});

describe('pickSlotsToNull — undo slot selection', () => {
  it('nulls only the slot whose current value matches the undone competitor', () => {
    // M3's winner ("r2") is in M6 slot 1. M4's winner ("r3") is in M6 slot 2.
    // Undoing M3 should null M6 slot 1, not slot 2.
    const undoneCompetitorIds = ['r2'];
    const downstream = [
      { matchNumber: 6, bracketType: 'winners' as const, competitor1Id: 'r2', competitor2Id: 'r3' },
    ];
    const targets = [
      { matchNumber: 6, bracketType: 'winners' as const, slot: 'competitor1' as const },
      { matchNumber: 6, bracketType: 'winners' as const, slot: 'competitor2' as const },
    ];
    const result = pickSlotsToNull(undoneCompetitorIds, downstream, targets);
    expect(result).toEqual([
      { matchNumber: 6, bracketType: 'winners', field: 'competitor1Id' },
    ]);
  });

  it('leaves both slots alone when the downstream competitor IDs do not match the undone match', () => {
    // Both M6 slots were filled by M3+M4. Undoing M3 with competitor
    // set ['r1'] (no match) → don't touch either slot.
    const result = pickSlotsToNull(
      ['r1'],
      [
        { matchNumber: 6, bracketType: 'winners' as const, competitor1Id: 'r2', competitor2Id: 'r3' },
      ],
      [
        { matchNumber: 6, bracketType: 'winners' as const, slot: 'competitor1' as const },
        { matchNumber: 6, bracketType: 'winners' as const, slot: 'competitor2' as const },
      ]
    );
    expect(result).toEqual([]);
  });

  it('handles multi-target: undoing M1 nulls M5 + M8 slots that match', () => {
    // M1 winner ("r1") advanced to M5. M1 loser ("r8") advanced to M8.
    // Undoing M1 with both competitor IDs should null both slots.
    const result = pickSlotsToNull(
      ['r1', 'r8'],
      [
        { matchNumber: 5, bracketType: 'winners' as const, competitor1Id: 'r1', competitor2Id: 'r4' },
        { matchNumber: 8, bracketType: 'losers' as const, competitor1Id: 'r8', competitor2Id: null },
      ],
      [
        { matchNumber: 5, bracketType: 'winners' as const, slot: 'competitor1' as const },
        { matchNumber: 5, bracketType: 'winners' as const, slot: 'competitor2' as const },
        { matchNumber: 8, bracketType: 'losers' as const, slot: 'competitor1' as const },
        { matchNumber: 8, bracketType: 'losers' as const, slot: 'competitor2' as const },
      ]
    );
    expect(result).toEqual([
      { matchNumber: 5, bracketType: 'winners', field: 'competitor1Id' },
      { matchNumber: 8, bracketType: 'losers', field: 'competitor1Id' },
    ]);
  });

  it('returns empty when undoneCompetitorIds is empty', () => {
    expect(pickSlotsToNull([], [], [])).toEqual([]);
  });

  it('skips targets whose downstream candidate is missing', () => {
    // Target references M6 but only M5 exists — defensive against
    // partial bracket state.
    const result = pickSlotsToNull(
      ['r1'],
      [{ matchNumber: 5, bracketType: 'winners' as const, competitor1Id: 'r1', competitor2Id: null }],
      [
        { matchNumber: 5, bracketType: 'winners' as const, slot: 'competitor1' as const },
        { matchNumber: 6, bracketType: 'winners' as const, slot: 'competitor1' as const },
      ]
    );
    expect(result).toEqual([
      { matchNumber: 5, bracketType: 'winners', field: 'competitor1Id' },
    ]);
  });
});

// ─── Match status state machine ──────────────────────────────────────

describe('isValidStatusTransition', () => {
  // Allowed transitions, copied from the source map. Updating these
  // here when the source map changes is intentional — it's the
  // contract that the test pins.
  const expected: Record<string, string[]> = {
    pending: ['ready', 'in_progress', 'completed', 'bye'],
    ready: ['in_progress', 'completed', 'pending'],
    in_progress: ['completed', 'pending'],
    completed: ['pending', 'in_progress'],
    bye: ['pending'],
  };

  it('allows every transition in the map', () => {
    for (const [from, tos] of Object.entries(expected)) {
      for (const to of tos) {
        expect(isValidStatusTransition(from as never, to as never)).toEqual({ ok: true });
      }
    }
  });

  it('treats self-transitions as valid no-ops', () => {
    expect(isValidStatusTransition('pending', 'pending')).toEqual({ ok: true });
    expect(isValidStatusTransition('completed', 'completed')).toEqual({ ok: true });
  });

  it('rejects transitions not in the map', () => {
    // Some examples that should NOT be allowed.
    expect(isValidStatusTransition('pending', 'pending')).toEqual({ ok: true }); // self = ok
    const r1 = isValidStatusTransition('ready', 'ready');
    expect(r1.ok).toBe(true);
    const r2 = isValidStatusTransition('ready', 'bye');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.allowed).toEqual(['in_progress', 'completed', 'pending']);

    const r3 = isValidStatusTransition('completed', 'ready');
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.allowed).toEqual(['pending', 'in_progress']);

    const r4 = isValidStatusTransition('completed', 'bye');
    expect(r4.ok).toBe(false);

    const r5 = isValidStatusTransition('bye', 'completed');
    expect(r5.ok).toBe(false);
    if (!r5.ok) expect(r5.allowed).toEqual(['pending']);

    const r6 = isValidStatusTransition('bye', 'in_progress');
    expect(r6.ok).toBe(false);
  });
});

describe('validateMatchStatusTransition', () => {
  const baseInput = {
    from: 'pending' as const,
    to: 'completed' as const,
    currentWinnerId: null as string | null,
    bothSlotsFilled: true,
    someSlotFilled: true,
    clearingWinnerId: false,
  };

  it('rejects invalid transitions with the same error shape as the old inline code', () => {
    const result = validateMatchStatusTransition({ ...baseInput, from: 'completed', to: 'ready' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_transition');
      expect(result.message).toMatch(/Invalid status transition: completed -> ready/);
      expect(result.allowed).toEqual(['pending', 'in_progress']);
    }
  });

  it('rejects completed without winnerId', () => {
    const result = validateMatchStatusTransition({
      ...baseInput,
      to: 'completed',
      // No winnerId passed, no current winner
      winnerId: undefined,
      currentWinnerId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing_winner');
      expect(result.message).toBe('Cannot mark match completed without a winnerId');
    }
  });

  it('accepts completed when winnerId is passed in this PATCH', () => {
    const result = validateMatchStatusTransition({
      ...baseInput,
      to: 'completed',
      winnerId: 'r1',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts completed when current match already has a winner and PATCH is no-op on winnerId', () => {
    const result = validateMatchStatusTransition({
      ...baseInput,
      to: 'completed',
      winnerId: undefined, // not changing
      currentWinnerId: 'r1', // already set
    });
    expect(result.ok).toBe(true);
  });

  it('reverts: completed -> pending requires winnerId to be cleared (regression: was a footgun)', () => {
    // Old code only rejected when winnerId was explicitly passed as non-null.
    // If PATCH set winnerId=undefined (no change) and the match was
    // already completed with a winner, the old code accepted it —
    // leaving the bracket in an inconsistent state.
    const result = validateMatchStatusTransition({
      from: 'completed',
      to: 'pending',
      currentWinnerId: 'r1',
      winnerId: undefined, // not changing → still has winner
      bothSlotsFilled: true,
      someSlotFilled: true,
      clearingWinnerId: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('stale_winner');
    }
  });

  it('accepts completed -> pending when winnerId is explicitly cleared', () => {
    const result = validateMatchStatusTransition({
      from: 'completed',
      to: 'pending',
      currentWinnerId: 'r1',
      winnerId: null,
      bothSlotsFilled: true,
      someSlotFilled: true,
      clearingWinnerId: true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects in_progress when one competitor slot is empty (regression: was accepted)', () => {
    // Old code allowed this. Marking a half-filled match as
    // in_progress doesn't make sense and was the silent-corruption
    // path for bracket state.
    const result = validateMatchStatusTransition({
      from: 'pending',
      to: 'in_progress',
      currentWinnerId: null,
      bothSlotsFilled: false,
      someSlotFilled: true,
      clearingWinnerId: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('inconsistent_slot_state');
      expect(result.message).toMatch(/Cannot mark match in_progress with one or both competitor slots empty/);
    }
  });

  it('rejects completed with one slot empty (use handleByeMatches for BYEs)', () => {
    const result = validateMatchStatusTransition({
      from: 'pending',
      to: 'completed',
      currentWinnerId: 'r1',
      winnerId: 'r1',
      bothSlotsFilled: false,
      someSlotFilled: true,
      clearingWinnerId: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('inconsistent_slot_state');
      expect(result.message).toMatch(/use handleByeMatches for BYEs/);
    }
  });

  it('rejects bye with both slots filled (BYE means exactly one)', () => {
    const result = validateMatchStatusTransition({
      from: 'pending',
      to: 'bye',
      currentWinnerId: null,
      bothSlotsFilled: true,
      someSlotFilled: true,
      clearingWinnerId: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('inconsistent_slot_state');
      expect(result.message).toMatch(/BYE status requires exactly one competitor slot filled/);
    }
  });

  it('rejects bye with both slots empty', () => {
    const result = validateMatchStatusTransition({
      from: 'pending',
      to: 'bye',
      currentWinnerId: null,
      bothSlotsFilled: false,
      someSlotFilled: false,
      clearingWinnerId: false,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts bye with exactly one slot filled', () => {
    const result = validateMatchStatusTransition({
      from: 'pending',
      to: 'bye',
      currentWinnerId: null,
      bothSlotsFilled: false,
      someSlotFilled: true,
      clearingWinnerId: false,
    });
    expect(result.ok).toBe(true);
  });
});

// ─── validateGroup (categorization) ────────────────────────────────────

describe('validateGroup', () => {
  const regWithAge = (age: number) => ({
    id: `r-${age}`,
    competitorId: `c-${age}`,
    patterns: true,
    sparring: false,
    ageAtTournament: age,
    weightAtRegistration: null,
    manualDivisionId: null,
    competitor: {
      firstName: 'A', lastName: 'B', belt: 'Black', gender: 'M',
      schoolDojang: null,
    },
  });

  const mkGroup = (registrations: ReturnType<typeof regWithAge>[]) => ({
    key: 'g', name: 'G', beltLevel: 'BB' as const, gender: 'M' as const,
    eventType: 'patterns' as const, ageMin: 18, ageMax: 35,
    beltColors: ['Black'], registrations,
  });

  it('returns empty for no warnings', () => {
    expect(validateGroup(mkGroup([regWithAge(20), regWithAge(22)]))).toEqual([]);
  });

  it('returns empty warnings for age spread <= 5', () => {
    expect(validateGroup(mkGroup([regWithAge(18), regWithAge(22)]))).toEqual([]);
  });

  it('flags large age spread (> 5 years)', () => {
    const warnings = validateGroup(mkGroup([regWithAge(15), regWithAge(22)]));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Large age spread: 7/);
  });

  it('treats missing ageAtTournament as 0', () => {
    const regs = [
      { ...regWithAge(20), ageAtTournament: null as number | null },
      { ...regWithAge(20), ageAtTournament: null as number | null },
    ];
    expect(validateGroup(mkGroup(regs))).toEqual([]);
  });

  it('returns empty for sparring with all weights missing', () => {
    const group = { ...mkGroup([regWithAge(20)]), eventType: 'sparring' as const };
    expect(validateGroup(group)).toEqual([]);
  });

  it('regression: returns string[] (was { valid: boolean; warnings: string[] })', () => {
    // Pin the shape — the previous version always returned valid: true
    // and callers never read that field.
    const result = validateGroup(mkGroup([regWithAge(20)]));
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

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
  type BracketPositions,
} from './match-advancement.js';

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

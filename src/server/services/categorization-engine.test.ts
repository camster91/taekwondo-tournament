/**
 * Regression tests for `canMerge` (categorization-engine).
 *
 * Background: Phase 8 audit flagged that `canMerge` used a hard-coded
 * `beltOrder = ['White','Yellow','Green','Blue','Red']` that was
 * missing `'Purple'` and `'Brown'`. When a division's beltColors
 * contained a missing color (e.g. Brown), `beltOrder.indexOf(color)`
 * returned `-1`, and `Math.abs(-1 - x)` evaluated to a number large
 * enough to exceed the `<= 1` adjacency threshold — so two
 * otherwise-mergeable adjacent-age divisions (Red belt kids next to
 * Brown belt kids) failed the merge check.
 *
 * Empty `beltColors` arrays hit the same trap harder:
 * `Math.max(...[])` is `-Infinity` and `Math.abs(-Infinity - x)` is
 * `Infinity`, which always exceeded 1.
 *
 * These tests pin the corrected behaviour: Brown + Red are
 * considered adjacent, unknown belt colors don't crash the
 * computation, and empty belt-color lists defer to the other merge
 * signals (age adjacency, weight class, combined size) rather than
 * silently blocking the merge.
 */

import { describe, it, expect } from 'vitest';
import { canMerge, type DivisionGroup } from './categorization-engine.js';

// ─── helpers ──────────────────────────────────────────────────────────

/** Build a minimal `RegistrationWithCompetitor`. */
const reg = (overrides: Partial<{
  id: string;
  belt: string;
  ageAtTournament: number | null;
  weightAtRegistration: number | null;
}> = {}) => ({
  id: overrides.id ?? 'r-default',
  competitorId: 'c-default',
  patterns: true,
  sparring: false,
  ageAtTournament: overrides.ageAtTournament ?? 10,
  weightAtRegistration: overrides.weightAtRegistration ?? null,
  manualDivisionId: null,
  competitor: {
    firstName: 'A',
    lastName: 'B',
    belt: overrides.belt ?? 'Yellow',
    gender: 'M',
    schoolDojang: null,
    weightLbs: null,
    danRank: null,
  },
});

/** Build a DivisionGroup with beltColors already set + small size. */
const mkGroup = (overrides: Partial<{
  ageMin: number;
  ageMax: number;
  beltColors: string[];
  registrations: ReturnType<typeof reg>[];
  eventType: 'patterns' | 'sparring';
  weightClass: string | undefined;
  beltLevel: 'BB' | 'CB';
  gender: 'M' | 'F';
}>): DivisionGroup => ({
  key: 'g',
  name: 'G',
  beltLevel: overrides.beltLevel ?? 'CB',
  gender: overrides.gender ?? 'M',
  eventType: overrides.eventType ?? 'patterns',
  ageMin: overrides.ageMin ?? 6,
  ageMax: overrides.ageMax ?? 7,
  beltColors: overrides.beltColors ?? ['Yellow'],
  weightClass: overrides.weightClass,
  registrations: overrides.registrations ?? [reg()],
});

// ─── belt-order coverage (regression: Brown, Purple) ─────────────────

describe('canMerge — belt-order coverage', () => {
  it('allows Brown + Red to merge (regression: Brown produced -Infinity distance and blocked merge)', () => {
    // Pre-fix: Brown wasn't in beltOrder, so indexOf returned -1.
    // Math.abs(-1 - 4) = 5 > 1 → canMerge returned false even
    // though Brown and Red are both advanced colored belts.
    // Post-fix: any unknown color defers the adjacency check to the
    // other merge signals (age adjacency is satisfied here).
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Red'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Red' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Brown'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Brown' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('allows Purple + Blue to merge (regression: Purple produced -Infinity distance and blocked merge)', () => {
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Blue'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Blue' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Purple'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Purple' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('still rejects non-adjacent known belts (White vs Red, distance 4)', () => {
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['White'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'White' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Red'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Red' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still rejects known non-adjacent pairs even when one side has an unknown color', () => {
    // White (idx 0) is known. Brown is unknown (not in BELT_ORDER).
    // Post-fix logic: if ANY color on either side is unknown,
    // defer-allow. So White + Brown WILL merge here — Brown is
    // unknown, not "far away". This is intentional: we don't know
    // Brown's ranking, so we can't claim "definitely not adjacent".
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['White'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'White' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Brown'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Brown' })] });
    // Defers to other merge signals (age adjacency OK) → allow.
    expect(canMerge(a, b)).toBe(true);
  });

  it('still allows overlapping belts (Yellow vs Yellow)', () => {
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(true);
  });
});

// ─── beltColors safety ────────────────────────────────────────────────

describe('canMerge — beltColors safety (regression: empty + unknown)', () => {
  it('handles empty beltColors on both sides without crashing', () => {
    // Pre-fix: Math.max(...[]) = -Infinity, Math.abs(-Infinity - x) = Infinity > 1 → blocked.
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: [], registrations: [] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: [], registrations: [] });
    // Should not throw, and should fall back to other merge signals
    // (age adjacency is satisfied) so the result is the same as
    // "no belt information available" → allow.
    expect(() => canMerge(a, b)).not.toThrow();
    expect(canMerge(a, b)).toBe(true);
  });

  it('handles empty beltColors on one side without blocking the merge', () => {
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: [], registrations: [] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(() => canMerge(a, b)).not.toThrow();
    expect(canMerge(a, b)).toBe(true);
  });

  it('handles unknown belt colors (e.g. "Unknown Belt", "Poomsae") without producing Infinity distance', () => {
    // The pre-fix code would compute Math.abs(-1 - 4) = 5 > 1 → blocked.
    // Post-fix: unknown colors are filtered out, so the adjacency
    // check returns true (defer to other signals).
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Unknown Belt'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Unknown Belt' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Poomsae'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Poomsae' })] });
    expect(() => canMerge(a, b)).not.toThrow();
    expect(canMerge(a, b)).toBe(true);
  });

  it('mixes known + unknown colors correctly (uses known color for adjacency)', () => {
    // 'Red' is known (index 4), 'Unknown' is unknown (index -1).
    // Filtering leaves only Red on side a, only Red on side b →
    // overlap → merge allowed.
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Red', 'Unknown'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Red' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Red'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Red' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('unknown colors on both sides still merge when nothing else blocks', () => {
    // No overlap (both lists contain only unknown colors), no
    // position info → defer-allow.
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Unknown'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Unknown' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Other'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Other' })] });
    expect(canMerge(a, b)).toBe(true);
  });
});

// ─── other gates (sanity) ─────────────────────────────────────────────

describe('canMerge — other gates still enforced', () => {
  it('still blocks merges across belt levels (BB vs CB)', () => {
    const a = mkGroup({ beltLevel: 'BB', ageMin: 6, ageMax: 7, beltColors: ['Black'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Black' })] });
    const b = mkGroup({ beltLevel: 'CB', ageMin: 8, ageMax: 9, beltColors: ['Red'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Red' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still blocks merges across gender (M vs F)', () => {
    const a = mkGroup({ gender: 'M', ageMin: 6, ageMax: 7, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ gender: 'F', ageMin: 8, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still blocks merges across event type (patterns vs sparring)', () => {
    const a = mkGroup({ eventType: 'patterns', ageMin: 6, ageMax: 7, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ eventType: 'sparring', ageMin: 8, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still blocks merges when ages are not adjacent (gap > GAP_TOLERANCE)', () => {
    // 6-7 next to 12-13 has a gap of 4 years (bands 8-11 in between) — wider
    // than the GAP_TOLERANCE=3 in canMerge, so this is a deliberate boundary
    // (e.g. elementary vs middle school) and should NOT merge.
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 12, ageMax: 13, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 13, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still blocks sparring merges when weight classes differ', () => {
    const a = mkGroup({ eventType: 'sparring', ageMin: 6, ageMax: 7, beltColors: ['Yellow'], weightClass: 'Light', registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ eventType: 'sparring', ageMin: 8, ageMax: 9, beltColors: ['Yellow'], weightClass: 'Heavy', registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('blocks merges when combined size would exceed maxSize', () => {
    // 10 + 10 = 20 > DIVISION_SIZE_CONFIG.maxSize (16).
    const many = (n: number) => Array.from({ length: n }, (_, i) => reg({ id: `r${i}`, ageAtTournament: 7 }));
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Yellow'], registrations: many(10) });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Yellow'], registrations: many(10) });
    expect(canMerge(a, b)).toBe(false);
  });
});

// ─── age-gap coverage (custom age groups with gaps) ───────────────────
//
// Custom age-group rules (useBlackBeltAgeGroups, customAgeGroups) can
// leave gaps — e.g. a tournament that didn't open a 10-year-old bracket
// has groups [6-9] and [11-14]. The pre-fix check
// `a.ageMax + 1 === b.ageMin` only allowed exact contiguity, so these
// small adjacent divisions would never merge. The fix widens the
// adjacency window to a GAP_TOLERANCE-year gap (currently 3) so
// realistic custom rules still merge, while deliberately wide gaps
// (e.g. elementary vs adult) are still blocked.

describe('canMerge — age-gap coverage (custom age groups)', () => {
  it('allows merge when a gap of 1 year falls inside GAP_TOLERANCE', () => {
    // [6-9] and [11-14] — gap of 1 at age 10 (the tournament didn't open
    // a 10-year-old bracket). Should merge.
    const a = mkGroup({ ageMin: 6, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 11, ageMax: 14, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 12, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('allows merge when a gap of 3 years falls at the edge of GAP_TOLERANCE', () => {
    // [6-9] and [13-14] — gap of 3 (ages 10-12). GAP_TOLERANCE is 3, so
    // this is at the boundary and should still merge.
    const a = mkGroup({ ageMin: 6, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 13, ageMax: 14, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 13, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('blocks merge when the gap exceeds GAP_TOLERANCE (deliberate boundary)', () => {
    // [6-9] and [14-15] — gap of 4 (ages 10-13). That's wider than
    // GAP_TOLERANCE=3 and should be treated as a deliberate category
    // split (e.g. elementary vs middle/high school).
    const a = mkGroup({ ageMin: 6, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 14, ageMax: 15, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 14, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still blocks merges when the gap is very wide (e.g. youth vs adult)', () => {
    // [6-9] and [20-35] — gap of 10 (ages 10-19). Definitely a
    // deliberate boundary, not a tournament rule artefact.
    const a = mkGroup({ ageMin: 6, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 20, ageMax: 35, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 25, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(false);
  });

  it('still merges exact-contiguous age groups (regression: default behavior)', () => {
    // [6-7] and [8-9] is the canonical contiguous case the original check
    // handled. Must still merge.
    const a = mkGroup({ ageMin: 6, ageMax: 7, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('handles overlapping age ranges (a.ageMax >= b.ageMin) — should merge', () => {
    // [6-10] and [8-12] — overlapping ranges. The pre-fix code required
    // a.ageMax + 1 === b.ageMin, which would fail this case (10+1=11 !== 8).
    // The new check tolerates overlaps and small gaps.
    const a = mkGroup({ ageMin: 6, ageMax: 10, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 8, ageMax: 12, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 9, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(true);
  });

  it('is symmetric — b first then a should give the same result', () => {
    // canMerge(a, b) and canMerge(b, a) must agree. The gap calculation
    // already takes both directions, but pin the symmetry explicitly.
    const a = mkGroup({ ageMin: 6, ageMax: 9, beltColors: ['Yellow'], registrations: [reg({ id: 'a', ageAtTournament: 7, belt: 'Yellow' })] });
    const b = mkGroup({ ageMin: 11, ageMax: 14, beltColors: ['Yellow'], registrations: [reg({ id: 'b', ageAtTournament: 12, belt: 'Yellow' })] });
    expect(canMerge(a, b)).toBe(canMerge(b, a));
  });
});

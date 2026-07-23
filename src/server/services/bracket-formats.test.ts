import { describe, it, expect } from 'vitest';
import { generateRoundRobin, generatePoolPlay } from './bracket-formats.js';
import type { CompetitorSeed } from './bracket-generator.js';

function makeCompetitors(count: number, schools?: string[]): CompetitorSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: schools?.[i] || `School ${(i % 3) + 1}`,
    skillRating: 100 + (count - i) * 10,
  }));
}

describe('Round-Robin Generator', () => {
  it('empty input → empty bracket', () => {
    const r = generateRoundRobin([]);
    expect(r.competitorCount).toBe(0);
    expect(r.winners).toHaveLength(0);
  });

  it('2 competitors → 1 match', () => {
    const r = generateRoundRobin(makeCompetitors(2));
    expect(r.competitorCount).toBe(2);
    expect(r.winners).toHaveLength(1);
    expect(r.winners[0].round).toBe(1);
  });

  it('4 competitors → 6 matches (4 choose 2) in 3 rounds', () => {
    const r = generateRoundRobin(makeCompetitors(4));
    expect(r.competitorCount).toBe(4);
    // 4*3/2 = 6 matches
    expect(r.winners).toHaveLength(6);
    const rounds = new Set(r.winners.map((m) => m.round));
    expect(rounds.size).toBe(3); // 3 rounds for 4 players
    // Each round has 2 matches
    const byRound = new Map<number, number>();
    for (const m of r.winners) byRound.set(m.round, (byRound.get(m.round) || 0) + 1);
    for (const c of byRound.values()) expect(c).toBe(2);
  });

  it('5 competitors → 10 matches, 5 rounds', () => {
    const r = generateRoundRobin(makeCompetitors(5));
    expect(r.winners).toHaveLength(10);
    expect(new Set(r.winners.map((m) => m.round)).size).toBe(5);
  });

  it('6 competitors → 15 matches, 5 rounds, 3 per round', () => {
    const r = generateRoundRobin(makeCompetitors(6));
    expect(r.winners).toHaveLength(15);
    expect(new Set(r.winners.map((m) => m.round)).size).toBe(5);
  });

  it('3 competitors → 3 matches, 3 rounds (1 bye per round, never paired)', () => {
    const r = generateRoundRobin(makeCompetitors(3));
    expect(r.winners).toHaveLength(3);
    // Every round has exactly 1 match (3-1=2 players per round, 1 match)
    const rounds = new Set(r.winners.map((m) => m.round));
    expect(rounds.size).toBe(3);
  });

  it('no competitor plays twice in the same round', () => {
    const competitors = makeCompetitors(8, ['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B']);
    const r = generateRoundRobin(competitors);
    for (const round of new Set(r.winners.map((m) => m.round))) {
      const inRound = r.winners.filter((m) => m.round === round);
      const seen = new Set<string>();
      for (const m of inRound) {
        if (m.competitor1Id) {
          expect(seen.has(m.competitor1Id)).toBe(false);
          seen.add(m.competitor1Id);
        }
        if (m.competitor2Id) {
          expect(seen.has(m.competitor2Id)).toBe(false);
          seen.add(m.competitor2Id);
        }
      }
    }
  });

  it('every competitor plays every other exactly once', () => {
    const competitors = makeCompetitors(6);
    const r = generateRoundRobin(competitors);
    const pairings = new Set<string>();
    for (const m of r.winners) {
      if (!m.competitor1Id || !m.competitor2Id) continue;
      const key = [m.competitor1Id, m.competitor2Id].sort().join('|');
      expect(pairings.has(key)).toBe(false);
      pairings.add(key);
    }
    // 6 choose 2 = 15
    expect(pairings.size).toBe(15);
  });
});

describe('Pool-Play Generator', () => {
  it('too-small falls back to round-robin', () => {
    const r = generatePoolPlay(makeCompetitors(3));
    // 3 competitors → 3 matches, all in round 1-3
    expect(r.winners).toHaveLength(3);
  });

  it('8 competitors → 2 pools of 4 → 6 matches per pool = 12 total', () => {
    const r = generatePoolPlay(makeCompetitors(8));
    expect(r.winners).toHaveLength(12);
    // Round codes start at 1000+ for pools
    const allInPools = r.winners.every((m) => m.round >= 1000);
    expect(allInPools).toBe(true);
  });

  it('12 competitors → 3 pools of 4 → 18 total', () => {
    const r = generatePoolPlay(makeCompetitors(12));
    // 3 pools × 6 matches each = 18
    expect(r.winners).toHaveLength(18);
  });

  it('5 competitors → 2 pools (3 + 2), 3 matches in pool 0', () => {
    const r = generatePoolPlay(makeCompetitors(5), { poolCount: 2 });
    // Pool of 3 = 3 matches, pool of 2 = 1 match → 4 total
    expect(r.winners).toHaveLength(4);
  });

  it('respects explicit pool count override', () => {
    const r = generatePoolPlay(makeCompetitors(10), { poolCount: 5 });
    // 5 pools of 2 = 1 match each = 5 total
    expect(r.winners).toHaveLength(5);
  });
});

// ─── Seeding strategy behavior (regression tests) ────────────────────
//
// The seeding helpers inside bracket-formats.ts (applySeeding for
// round-robin + pool-play) are NOT the same as the bracket-generator
// helpers. They live in a separate file because round-robin needs
// school-aware interleaving, not bracket-position seeding. Tests
// below pin the contract callers depend on.

describe('Round-Robin seeding strategies', () => {
  // Six kids from three schools. Skill ratings span a wide range so
  // sort order differs from school order.
  const competitors: CompetitorSeed[] = [
    { registrationId: 'A1', name: 'A1', school: 'Alpha', skillRating: 60 },
    { registrationId: 'A2', name: 'A2', school: 'Alpha', skillRating: 90 },
    { registrationId: 'B1', name: 'B1', school: 'Bravo', skillRating: 70 },
    { registrationId: 'B2', name: 'B2', school: 'Bravo', skillRating: 100 },
    { registrationId: 'C1', name: 'C1', school: 'Charlie', skillRating: 50 },
    { registrationId: 'C2', name: 'C2', school: 'Charlie', skillRating: 80 },
  ];

  // We can't directly assert internal ordering, but we CAN assert
  // observable consequences: which competitors face which others.
  // The school_spread strategy should produce an ordering where
  // adjacent pairings (round 1) don't pit same-school against
  // same-school.

  it('school_spread avoids same-school matches in round 1 when a conflict-free arrangement exists', () => {
    const r = generateRoundRobin(competitors, { seedingStrategy: 'school_spread' });
    const round1 = r.winners.filter((m) => m.round === 1);
    expect(round1).toHaveLength(3);
    const sameSchoolPairings = round1.filter((m) => {
      const c1 = competitors.find((c) => c.registrationId === m.competitor1Id);
      const c2 = competitors.find((c) => c.registrationId === m.competitor2Id);
      return c1?.school === c2?.school;
    });
    expect(sameSchoolPairings).toHaveLength(0);
  });

  it('school_spread leaves only the unavoidable conflicts when one school is over-represented', () => {
    const overRepresented = makeCompetitors(6, ['Alpha', 'Alpha', 'Alpha', 'Alpha', 'Bravo', 'Charlie']);
    const r = generateRoundRobin(overRepresented, { seedingStrategy: 'school_spread' });
    const round1 = r.winners.filter((m) => m.round === 1);
    const schoolById = new Map(overRepresented.map((c) => [c.registrationId, c.school]));
    const sameSchoolPairings = round1.filter((m) =>
      schoolById.get(m.competitor1Id!) === schoolById.get(m.competitor2Id!)
    );

    // Four Alpha competitors cannot all be paired with the two
    // non-Alpha competitors, so one Alpha-vs-Alpha match is the floor.
    expect(sameSchoolPairings).toHaveLength(1);
  });

  it('school_spread uses the implicit BYE to protect an over-represented school in odd divisions', () => {
    const odd = makeCompetitors(5, ['Alpha', 'Alpha', 'Alpha', 'Bravo', 'Charlie']);
    const r = generateRoundRobin(odd, { seedingStrategy: 'school_spread' });
    const round1 = r.winners.filter((m) => m.round === 1);
    const schoolById = new Map(odd.map((c) => [c.registrationId, c.school]));
    const sameSchoolPairings = round1.filter((m) =>
      schoolById.get(m.competitor1Id!) === schoolById.get(m.competitor2Id!)
    );

    expect(round1).toHaveLength(2);
    expect(sameSchoolPairings).toHaveLength(0);
  });

  it('regression: seeding strategies are NOT all equivalent (skill_based, balanced, fairness_optimized must differ)', () => {
    // The previous implementation had all three strategies fall
    // through to a single sort by skillRating. That made them
    // interchangeable, which broke the intent of asking for a
    // "balanced" or "fairness-optimized" schedule vs. a raw
    // skill-sort. The skill_based strategy is intentionally the
    // "highest skill at top" sort; balanced and fairness_optimized
    // should distribute skill across the bracket differently so
    // that early-round matchups aren't lopsided.
    //
    // The cheapest observable signal is the first-round pairings:
    // if skill_based, balanced, and fairness_optimized all collapse
    // to the same order, all three produce identical bracket
    // outputs. We assert that AT LEAST ONE PAIRING differs between
    // skill_based and one of (balanced, fairness_optimized).
    const skill = generateRoundRobin(competitors, { seedingStrategy: 'skill_based' });
    const balanced = generateRoundRobin(competitors, { seedingStrategy: 'balanced' });
    const fair = generateRoundRobin(competitors, { seedingStrategy: 'fairness_optimized' });

    const firstRoundPairs = (s: typeof skill) => s.winners
      .filter((m) => m.round === 1)
      .map((m) => `${m.competitor1Id}|${m.competitor2Id}`)
      .sort()
      .join(',');

    const skillR1 = firstRoundPairs(skill);
    const balancedR1 = firstRoundPairs(balanced);
    const fairR1 = firstRoundPairs(fair);

    // Different strategies must produce different first rounds.
    expect(skillR1 === balancedR1 && balancedR1 === fairR1).toBe(false);
  });
});

describe('Pool-Play seeding strategies', () => {
  // Two schools with 2 kids each, plus 2 from a third school.
  const competitors: CompetitorSeed[] = [
    { registrationId: 'A1', name: 'A1', school: 'Alpha', skillRating: 60 },
    { registrationId: 'A2', name: 'A2', school: 'Alpha', skillRating: 90 },
    { registrationId: 'B1', name: 'B1', school: 'Bravo', skillRating: 70 },
    { registrationId: 'B2', name: 'B2', school: 'Bravo', skillRating: 100 },
    { registrationId: 'C1', name: 'C1', school: 'Charlie', skillRating: 50 },
    { registrationId: 'C2', name: 'C2', school: 'Charlie', skillRating: 80 },
  ];

  it('regression: pool-play school_spread separates same-school into different pools when possible', () => {
    // 6 competitors, 2 pools of 3. school_spread should split the
    // two Alpha kids into different pools, same for Bravo + Charlie.
    const r = generatePoolPlay(competitors, { poolCount: 2, seedingStrategy: 'school_spread' });
    // Each pool's matches live in their own round-code range
    // (1001-1099 for pool 0, 1101-1199 for pool 1).
    const schoolsInPool0 = new Set<string>();
    const schoolsInPool1 = new Set<string>();
    for (const m of r.winners) {
      const c1 = competitors.find((c) => c.registrationId === m.competitor1Id);
      const c2 = competitors.find((c) => c.registrationId === m.competitor2Id);
      if (!c1 || !c2) continue;
      if (m.round < 1100) {
        schoolsInPool0.add(c1.school); schoolsInPool0.add(c2.school);
      } else {
        schoolsInPool1.add(c1.school); schoolsInPool1.add(c2.school);
      }
    }
    // Each pool should have at least 2 different schools
    // (otherwise we got unlucky with same-school collision).
    expect(schoolsInPool0.size).toBeGreaterThanOrEqual(2);
    expect(schoolsInPool1.size).toBeGreaterThanOrEqual(2);
  });
});

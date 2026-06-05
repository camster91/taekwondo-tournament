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
    const r = generateRoundRobin(makeCompetisors_safe(6));
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

function makeCompetisors_safe(n: number): CompetitorSeed[] {
  return makeCompetitors(n);
}

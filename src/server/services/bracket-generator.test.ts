import { describe, it, expect } from 'vitest';
import { generateSingleElimination, type CompetitorSeed } from './bracket-generator.js';

const seeded = (n: number): CompetitorSeed[] =>
  Array.from({ length: n }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: `School ${i % 3 + 1}`,
    seedPosition: i + 1,
  }));

describe('Single-Elimination Generator', () => {
  it('returns empty structure for zero competitors', () => {
    const result = generateSingleElimination([]);
    expect(result.winners).toEqual([]);
    expect(result.losers).toEqual([]);
    expect(result.finals).toEqual([]);
    expect(result.competitorCount).toBe(0);
  });

  it('returns single-competitor finals with no opponents', () => {
    const result = generateSingleElimination(seeded(1));
    expect(result.winners).toEqual([]);
    expect(result.losers).toEqual([]);
    expect(result.finals).toHaveLength(1);
    expect(result.finals[0].competitor1Id).toBe('reg-1');
    expect(result.finals[0].competitor2Id).toBeNull();
  });

  it('4 competitors produce 2 round-1 matches + 1 final = 3 total matches', () => {
    const result = generateSingleElimination(seeded(4));
    expect(result.winners).toHaveLength(2);
    expect(result.losers).toHaveLength(0);
    expect(result.finals).toHaveLength(1);
    expect(result.competitorCount).toBe(4);
    // Each round-1 match should have both competitors filled.
    for (const m of result.winners) {
      expect(m.competitor1Id).toBeTruthy();
      expect(m.competitor2Id).toBeTruthy();
    }
  });

  it('8 competitors produce 4 + 2 + 1 = 7 matches', () => {
    const result = generateSingleElimination(seeded(8));
    expect(result.winners).toHaveLength(6); // 4 round-1 + 2 semis
    expect(result.losers).toHaveLength(0);
    expect(result.finals).toHaveLength(1);
    expect(result.winners.length + result.losers.length + result.finals.length).toBe(7);
  });

  it('pads to next power of 2 with byes for non-power-of-2 counts', () => {
    const result = generateSingleElimination(seeded(5));
    // 5 competitors padded to 8 = 4 round-1 matches (2 with byes — the
    // 3 null slots pair up into one (null, null) match and one (real, null)
    // match) + 2 semis + 1 final.
    expect(result.winners).toHaveLength(6);
    expect(result.finals).toHaveLength(1);
    const round1 = result.winners.filter(m => m.round === 1);
    expect(round1).toHaveLength(4);
    const byes = round1.filter(m => m.competitor1Id === null || m.competitor2Id === null);
    expect(byes.length).toBe(2);
  });

  it('round numbers progress correctly', () => {
    const result = generateSingleElimination(seeded(8));
    const r1 = result.winners.filter(m => m.round === 1);
    const r2 = result.winners.filter(m => m.round === 2);
    const r3 = result.finals.filter(m => m.round === 3);
    expect(r1).toHaveLength(4);
    expect(r2).toHaveLength(2);
    expect(r3).toHaveLength(1);
  });

  it('winner of round 1 links forward to the next round', () => {
    const result = generateSingleElimination(seeded(4));
    const m1 = result.winners[0]; // match 1
    expect(m1.nextWinnerMatch).toBe(3); // final is match 3
    const m2 = result.winners[1]; // match 2
    expect(m2.nextWinnerMatch).toBe(3);
  });
});

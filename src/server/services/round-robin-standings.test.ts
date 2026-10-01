/**
 * Round robin used to produce no placements and never complete: the
 * placement resolver and completion check only understood elimination
 * brackets' named grand final. Pool play has no finals stage at all, so
 * generation of it is rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  getBracketPlacementsFromLoaded,
  isBracketComplete,
  isRoundRobinStructure,
  resolveRoundRobinStandings,
} from './match-advancement.js';
import { bracketFormatError, generatePoolPlay, generateRoundRobin } from './bracket-formats.js';
import { assertDeterministicCorrectionConfig } from './bracket-correction.js';

type Row = {
  matchNumber: number;
  bracketType: 'winners';
  status: string;
  winnerId: string | null;
  competitor1Id: string | null;
  competitor2Id: string | null;
  score1?: string | null;
  score2?: string | null;
};

let n = 0;
const played = (a: string, b: string, winner: string, score1?: string, score2?: string): Row => ({
  matchNumber: ++n,
  bracketType: 'winners',
  status: 'completed',
  winnerId: winner,
  competitor1Id: a,
  competitor2Id: b,
  score1: score1 ?? null,
  score2: score2 ?? null,
});

const seeds = (ids: string[]) => ids.map((id) => ({ registrationId: id, name: id, school: `S-${id}` }));

describe('round robin standings', () => {
  it('ranks by wins', () => {
    const rows = [played('A', 'B', 'A'), played('A', 'C', 'A'), played('B', 'C', 'B')];
    expect(resolveRoundRobinStandings(rows)).toEqual([
      { place: 1, competitorId: 'A' },
      { place: 2, competitorId: 'B' },
      { place: 3, competitorId: 'C' },
    ]);
  });

  it('breaks a two-way tie on wins by head-to-head', () => {
    // A and B both 2-1; B beat A.
    const rows = [
      played('A', 'B', 'B'), played('A', 'C', 'A'), played('A', 'D', 'A'),
      played('B', 'C', 'C'), played('B', 'D', 'B'), played('C', 'D', 'D'),
    ];
    const standings = resolveRoundRobinStandings(rows);
    expect(standings.slice(0, 2)).toEqual([
      { place: 1, competitorId: 'B' },
      { place: 2, competitorId: 'A' },
    ]);
  });

  it('breaks a head-to-head cycle by point differential when scores are numeric', () => {
    // A beat B, B beat C, C beat A — all 1-1.
    const rows = [
      played('A', 'B', 'A', '10', '0'),
      played('B', 'C', 'B', '5', '4'),
      played('C', 'A', 'C', '3', '2'),
    ];
    // Diffs: A +10 -1 = +9; B -10 +1 = -9; C -1 +1 = 0.
    expect(resolveRoundRobinStandings(rows)).toEqual([
      { place: 1, competitorId: 'A' },
      { place: 2, competitorId: 'C' },
      { place: 3, competitorId: 'B' },
    ]);
  });

  it('shares the place when a tie cannot be broken (non-numeric scores)', () => {
    const rows = [played('A', 'B', 'A'), played('B', 'C', 'B'), played('C', 'A', 'C')];
    const standings = resolveRoundRobinStandings(rows);
    expect(standings).toHaveLength(3);
    expect(standings.every((p) => p.place === 1)).toBe(true);
  });

  it('reports nothing until every match is completed', () => {
    const rows = [played('A', 'B', 'A'), { ...played('A', 'C', 'A'), status: 'ready', winnerId: null }];
    expect(resolveRoundRobinStandings(rows)).toEqual([]);
  });
});

describe('round robin brackets end to end (stored structure)', () => {
  const structure = generateRoundRobin(seeds(['A', 'B', 'C']), { seedingStrategy: 'manual' });

  it('is recognised as round robin; pool play and elimination are not', () => {
    expect(isRoundRobinStructure(structure)).toBe(true);
    expect(isRoundRobinStructure(generatePoolPlay(seeds(['A', 'B', 'C', 'D', 'E', 'F'])))).toBe(false);
  });

  it('produces placements and completes once all matches are played', () => {
    const rows: Row[] = structure.winners.map((m) => ({
      matchNumber: m.matchNumber,
      bracketType: 'winners',
      status: 'completed',
      // Alphabetically-first competitor always wins: A 2-0, B 1-1, C 0-2.
      winnerId: [m.competitor1Id!, m.competitor2Id!].sort()[0],
      competitor1Id: m.competitor1Id,
      competitor2Id: m.competitor2Id,
    }));
    expect(getBracketPlacementsFromLoaded(JSON.stringify(structure), rows)).toEqual([
      { place: 1, competitorId: 'A' },
      { place: 2, competitorId: 'B' },
      { place: 3, competitorId: 'C' },
    ]);
    expect(isBracketComplete(rows, structure)).toBe(true);
    expect(isBracketComplete([{ ...rows[0], status: 'ready' }, ...rows.slice(1)], structure)).toBe(false);
  });
});

describe('pool play is not generatable', () => {
  it('rejects pool_play and unknown formats with a clear message', () => {
    expect(bracketFormatError('pool_play')).toMatch(/Pool play is not available/);
    expect(bracketFormatError('swiss')).toMatch(/Unknown bracket format/);
    expect(bracketFormatError('round_robin')).toBeNull();
    expect(bracketFormatError('double_elim')).toBeNull();
    expect(bracketFormatError('single_elim')).toBeNull();
  });

  it('rejects pool_play in the correction flow', () => {
    expect(() => assertDeterministicCorrectionConfig({ format: 'pool_play', seedingStrategy: 'school_spread' }))
      .toThrow(/Pool play is not available/);
    expect(() => assertDeterministicCorrectionConfig({ format: 'round_robin', seedingStrategy: 'school_spread' }))
      .not.toThrow();
  });
});

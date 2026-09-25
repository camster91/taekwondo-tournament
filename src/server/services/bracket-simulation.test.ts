// Full-bracket simulations for the advancement engine.
//
// Every elimination bracket size must be playable end to end: byes
// (first round AND the empty slots they create in the losers bracket)
// resolve automatically, every contested match eventually becomes
// `ready`, and the bracket ends with a recorded champion. These pin
// the fixes for:
//   - DE brackets with byes stalling in the losers bracket (N=3, 5-7, 9-15...)
//   - SE brackets with null-v-null first-round matches (N=5-6, 9-12)
//   - re-submitting a result re-advancing the winner / corrections
//   - undo not clearing downstream slots / activated reset matches
//   - placements crowning a champion before an active reset is played
//   - SE never awarding 3rd place

import { describe, it, expect } from 'vitest';
import {
  generateBracket,
  generateSingleElimination,
  type BracketStructure,
  type CompetitorSeed,
} from './bracket-generator.js';
import {
  computeBracketSync,
  isBracketComplete,
  getBracketPlacementsFromLoaded,
  BracketAdvancementConflictError,
  type EngineMatch,
} from './match-advancement.js';

const seeded = (n: number): CompetitorSeed[] =>
  Array.from({ length: n }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: `School ${i + 1}`,
    seedPosition: i + 1,
  }));

type Row = EngineMatch & { roundNumber: number };

function toRows(structure: BracketStructure): Row[] {
  const rows: Row[] = [];
  const push = (arr: BracketStructure['winners'], bracketType: string) => {
    for (const m of arr) {
      rows.push({
        id: `m-${m.matchNumber}`,
        matchNumber: m.matchNumber,
        roundNumber: m.round,
        bracketType,
        competitor1Id: m.competitor1Id,
        competitor2Id: m.competitor2Id,
        winnerId: null,
        status: m.competitor1Id && m.competitor2Id ? 'ready' : 'pending',
        notes: null,
      });
    }
  };
  push(structure.winners, 'winners');
  push(structure.losers, 'losers');
  push(structure.finals, 'finals');
  return rows;
}

/** Apply engine updates to the in-memory rows (what the DB layer does). */
function sync(structure: BracketStructure, rows: Row[]): void {
  const updates = computeBracketSync(structure, rows);
  for (const u of updates) {
    const row = rows.find((r) => r.id === u.id)!;
    Object.assign(row, u.data);
  }
}

function record(structure: BracketStructure, rows: Row[], matchNumber: number, winnerId: string): void {
  const row = rows.find((r) => r.matchNumber === matchNumber)!;
  expect([row.competitor1Id, row.competitor2Id]).toContain(winnerId);
  row.winnerId = winnerId;
  row.status = 'completed';
  sync(structure, rows);
}

const seedNum = (id: string) => Number(id.split('-')[1]);

type Policy = (m: Row, rng: () => number) => string;
const favourite: Policy = (m) =>
  seedNum(m.competitor1Id!) < seedNum(m.competitor2Id!) ? m.competitor1Id! : m.competitor2Id!;
const underdog: Policy = (m) =>
  seedNum(m.competitor1Id!) > seedNum(m.competitor2Id!) ? m.competitor1Id! : m.competitor2Id!;
const coinFlip: Policy = (m, rng) => (rng() < 0.5 ? m.competitor1Id! : m.competitor2Id!);

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playOut(structure: BracketStructure, policy: Policy, rngSeed = 1) {
  const rows = toRows(structure);
  sync(structure, rows);
  const rng = mulberry32(rngSeed);
  let played = 0;
  for (let guard = 0; guard < 500; guard++) {
    const ready = rows
      .filter((r) => r.status === 'ready')
      .sort((a, b) => a.matchNumber - b.matchNumber);
    if (ready.length === 0) break;
    const m = ready[Math.floor(rng() * ready.length)];
    record(structure, rows, m.matchNumber, policy(m, rng));
    played++;
  }
  return { rows, played };
}

function losses(rows: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'completed' || !r.winnerId || !r.competitor1Id || !r.competitor2Id) continue;
    const loser = r.winnerId === r.competitor1Id ? r.competitor2Id : r.competitor1Id;
    out.set(loser, (out.get(loser) ?? 0) + 1);
  }
  return out;
}

function assertFinished(structure: BracketStructure, rows: Row[], n: number, maxLosses: number) {
  // Nothing left waiting: every match is completed, or is a reset
  // match that was never activated.
  const stuck = rows.filter((r) =>
    r.status !== 'completed' &&
    !(r.matchNumber === structure.positions.reset && !r.competitor1Id && !r.competitor2Id)
  );
  expect(stuck.map((r) => `${r.bracketType} ${r.matchNumber} ${r.status} ${r.competitor1Id}/${r.competitor2Id}`)).toEqual([]);
  expect(isBracketComplete(rows, structure)).toBe(true);

  const placements = getBracketPlacementsFromLoaded(JSON.stringify(structure), rows);
  const first = placements.filter((p) => p.place === 1);
  expect(first).toHaveLength(1);
  if (n >= 2) expect(placements.filter((p) => p.place === 2)).toHaveLength(1);

  // Champion never lost more than allowed; everyone else lost out.
  const l = losses(rows);
  expect(l.get(first[0].competitorId) ?? 0).toBeLessThanOrEqual(Math.max(0, maxLosses - 1));
  for (let i = 1; i <= n; i++) {
    const id = `reg-${i}`;
    if (id === first[0].competitorId) continue;
    expect(l.get(id), `${id} should be eliminated`).toBe(maxLosses);
  }
  return placements;
}

describe('double elimination — every size can be played to a champion', () => {
  for (let n = 1; n <= 17; n++) {
    for (const [name, policy] of [['favourite', favourite], ['underdog', underdog], ['coin flip', coinFlip]] as const) {
      it(`N=${n} (${name})`, () => {
        const structure = generateBracket(seeded(n), 'manual');
        const { rows } = playOut(structure, policy, n * 7 + 3);
        assertFinished(structure, rows, n, n === 1 ? 0 : 2);
      });
    }
  }

  it('N=32 and N=64 (coin flip, several seeds)', () => {
    for (const n of [24, 32, 33, 64]) {
      for (const seed of [1, 2, 3]) {
        const structure = generateBracket(seeded(n), 'manual');
        const { rows } = playOut(structure, coinFlip, seed);
        assertFinished(structure, rows, n, 2);
      }
    }
  });

  it('losers-bracket champion winning the grand final activates the reset, and 1st/2nd wait for it', () => {
    const structure = generateBracket(seeded(8), 'manual');
    const rows = toRows(structure);
    sync(structure, rows);
    const gfNum = structure.positions.grandFinals!;
    const resetNum = structure.positions.reset!;
    // Play everything up to the grand final with favourites.
    for (;;) {
      const ready = rows.filter((r) => r.status === 'ready' && r.matchNumber !== gfNum);
      if (ready.length === 0) break;
      record(structure, rows, ready[0].matchNumber, favourite(ready[0], Math.random));
    }
    const gf = rows.find((r) => r.matchNumber === gfNum)!;
    expect(gf.status).toBe('ready');
    const lbChamp = gf.competitor2Id!;
    record(structure, rows, gfNum, lbChamp);

    const reset = rows.find((r) => r.matchNumber === resetNum)!;
    expect(reset.status).toBe('ready');
    expect([reset.competitor1Id, reset.competitor2Id].sort()).toEqual([gf.competitor1Id, gf.competitor2Id].sort());
    expect(isBracketComplete(rows, structure)).toBe(false);
    // Regression: the LB champion was crowned here before the reset.
    const provisional = getBracketPlacementsFromLoaded(JSON.stringify(structure), rows);
    expect(provisional.find((p) => p.place === 1)).toBeUndefined();
    expect(provisional.find((p) => p.place === 2)).toBeUndefined();

    record(structure, rows, resetNum, gf.competitor1Id!);
    const final = getBracketPlacementsFromLoaded(JSON.stringify(structure), rows);
    expect(final.find((p) => p.place === 1)?.competitorId).toBe(gf.competitor1Id);
    expect(final.find((p) => p.place === 2)?.competitorId).toBe(lbChamp);
  });
});

describe('single elimination — every size can be played to a champion', () => {
  for (let n = 1; n <= 17; n++) {
    it(`N=${n}`, () => {
      const structure = generateSingleElimination(seeded(n), 'manual');
      // Regression: no first-round match may be null-v-null.
      for (const m of [...structure.winners, ...structure.finals].filter((x) => x.round === 1)) {
        expect(m.competitor1Id || m.competitor2Id, `R1 match ${m.matchNumber} is empty`).toBeTruthy();
      }
      for (const [policy, seed] of [[favourite, 1], [underdog, 2], [coinFlip, 3]] as const) {
        const { rows } = playOut(structure, policy, seed);
        const placements = assertFinished(structure, rows, n, n === 1 ? 0 : 1);
        // 3rd place: both semifinal losers (when the semis were contested).
        const thirds = placements.filter((p) => p.place === 3);
        if (n >= 4) expect(thirds).toHaveLength(2);
        if (n === 3) expect(thirds).toHaveLength(1);
        if (n <= 2) expect(thirds).toHaveLength(0);
      }
    });
  }

  it('byes go to the top seeds (N=5: seeds 1-3 have byes)', () => {
    const structure = generateSingleElimination(seeded(5), 'manual');
    const r1 = structure.winners.filter((m) => m.round === 1);
    const byeHolders = r1
      .filter((m) => !m.competitor1Id || !m.competitor2Id)
      .map((m) => m.competitor1Id ?? m.competitor2Id)
      .sort();
    expect(byeHolders).toEqual(['reg-1', 'reg-2', 'reg-3']);
  });
});

describe('advancement is idempotent and supports corrections', () => {
  function setup() {
    const structure = generateBracket(seeded(8), 'manual');
    const rows = toRows(structure);
    sync(structure, rows);
    return { structure, rows };
  }
  const find = (rows: Row[], n: number) => rows.find((r) => r.matchNumber === n)!;

  it('re-submitting the same result does not duplicate the winner downstream', () => {
    const { structure, rows } = setup();
    const m1 = structure.winners[0];
    record(structure, rows, m1.matchNumber, m1.competitor1Id!);
    const before = JSON.stringify(rows);
    // Resubmit (e.g. score fix): same winner, same status.
    record(structure, rows, m1.matchNumber, m1.competitor1Id!);
    expect(JSON.stringify(rows)).toBe(before);
    const next = find(rows, m1.nextWinnerMatch!);
    expect([next.competitor1Id, next.competitor2Id].filter((c) => c === m1.competitor1Id)).toHaveLength(1);
  });

  it('changing the winner replaces the old winner/loser downstream', () => {
    const { structure, rows } = setup();
    const m1 = structure.winners[0];
    record(structure, rows, m1.matchNumber, m1.competitor1Id!);
    record(structure, rows, m1.matchNumber, m1.competitor2Id!);
    const w = find(rows, m1.nextWinnerMatch!);
    const l = find(rows, m1.nextLoserMatch!);
    expect([w.competitor1Id, w.competitor2Id]).toContain(m1.competitor2Id);
    expect([w.competitor1Id, w.competitor2Id]).not.toContain(m1.competitor1Id);
    expect([l.competitor1Id, l.competitor2Id]).toContain(m1.competitor1Id);
    expect([l.competitor1Id, l.competitor2Id]).not.toContain(m1.competitor2Id);
  });

  it('sibling results land in fixed, distinct slots regardless of completion order', () => {
    const a = setup();
    const b = setup();
    const [m1, m2] = [a.structure.winners[0], a.structure.winners[1]];
    record(a.structure, a.rows, m1.matchNumber, m1.competitor1Id!);
    record(a.structure, a.rows, m2.matchNumber, m2.competitor1Id!);
    record(b.structure, b.rows, m2.matchNumber, m2.competitor1Id!);
    record(b.structure, b.rows, m1.matchNumber, m1.competitor1Id!);
    const ta = find(a.rows, m1.nextWinnerMatch!);
    const tb = find(b.rows, m1.nextWinnerMatch!);
    expect([ta.competitor1Id, ta.competitor2Id]).toEqual([tb.competitor1Id, tb.competitor2Id]);
    expect(ta.competitor1Id).toBe(m1.competitor1Id);
    expect(ta.competitor2Id).toBe(m2.competitor1Id);
    expect(ta.status).toBe('ready');
  });

  it('refuses a correction once the downstream match has started', () => {
    const { structure, rows } = setup();
    const [m1, m2] = [structure.winners[0], structure.winners[1]];
    record(structure, rows, m1.matchNumber, m1.competitor1Id!);
    record(structure, rows, m2.matchNumber, m2.competitor1Id!);
    find(rows, m1.nextWinnerMatch!).status = 'in_progress';
    const row = find(rows, m1.matchNumber);
    row.winnerId = m1.competitor2Id;
    expect(() => computeBracketSync(structure, rows)).toThrow(BracketAdvancementConflictError);
  });

  it('never demotes an in_progress match back to ready', () => {
    const { structure, rows } = setup();
    const m1 = find(rows, 1);
    m1.status = 'in_progress';
    sync(structure, rows);
    expect(m1.status).toBe('in_progress');
  });

  it('undo (match back to ready) clears the downstream slots it filled', () => {
    const { structure, rows } = setup();
    const m1 = structure.winners[0];
    record(structure, rows, m1.matchNumber, m1.competitor1Id!);
    const row = find(rows, m1.matchNumber);
    row.status = 'ready';
    row.winnerId = null;
    sync(structure, rows);
    const w = find(rows, m1.nextWinnerMatch!);
    const l = find(rows, m1.nextLoserMatch!);
    expect([w.competitor1Id, w.competitor2Id]).toEqual([null, null]);
    expect([l.competitor1Id, l.competitor2Id]).toEqual([null, null]);
  });

  it('undoing / correcting the grand final clears an activated (unplayed) reset', () => {
    const { structure, rows } = setup();
    const gfNum = structure.positions.grandFinals!;
    const resetNum = structure.positions.reset!;
    for (;;) {
      const ready = rows.filter((r) => r.status === 'ready' && r.matchNumber !== gfNum);
      if (ready.length === 0) break;
      record(structure, rows, ready[0].matchNumber, favourite(ready[0], Math.random));
    }
    const gf = find(rows, gfNum);
    record(structure, rows, gfNum, gf.competitor2Id!);
    expect(find(rows, resetNum).status).toBe('ready');

    // Correct the GF: WB champion actually won → reset deactivated.
    record(structure, rows, gfNum, gf.competitor1Id!);
    const reset = find(rows, resetNum);
    expect(reset.status).toBe('pending');
    expect([reset.competitor1Id, reset.competitor2Id]).toEqual([null, null]);

    // LB champion again, then undo the GF entirely.
    record(structure, rows, gfNum, gf.competitor2Id!);
    gf.status = 'ready';
    gf.winnerId = null;
    sync(structure, rows);
    expect(find(rows, resetNum).competitor1Id).toBeNull();
    expect(isBracketComplete(rows, structure)).toBe(false);
  });

  it('refuses to undo the grand final once the reset has been played', () => {
    const { structure, rows } = setup();
    const gfNum = structure.positions.grandFinals!;
    const resetNum = structure.positions.reset!;
    for (;;) {
      const ready = rows.filter((r) => r.status === 'ready' && r.matchNumber !== gfNum);
      if (ready.length === 0) break;
      record(structure, rows, ready[0].matchNumber, favourite(ready[0], Math.random));
    }
    const gf = find(rows, gfNum);
    record(structure, rows, gfNum, gf.competitor2Id!);
    record(structure, rows, resetNum, gf.competitor1Id!);
    gf.status = 'ready';
    gf.winnerId = null;
    expect(() => computeBracketSync(structure, rows)).toThrow(BracketAdvancementConflictError);
  });

  it('accepts legacy brackets whose downstream slot order differs (fill-first-empty)', () => {
    const { structure, rows } = setup();
    const [m1, m2] = [structure.winners[0], structure.winners[1]];
    record(structure, rows, m1.matchNumber, m1.competitor1Id!);
    record(structure, rows, m2.matchNumber, m2.competitor1Id!);
    const target = find(rows, m1.nextWinnerMatch!);
    [target.competitor1Id, target.competitor2Id] = [target.competitor2Id, target.competitor1Id];
    target.status = 'completed';
    target.winnerId = target.competitor1Id;
    // Must not throw even though the slots are "swapped".
    expect(() => computeBracketSync(structure, rows)).not.toThrow();
  });

  it('repairs a legacy stalled losers-bracket match stuck in `bye`', () => {
    const structure = generateBracket(seeded(5), 'manual');
    const rows = toRows(structure);
    // Simulate the old behaviour: only R1 byes handled, a losers match
    // marked `bye` with a single competitor.
    const lr1 = rows.find((r) => r.bracketType === 'losers')!;
    lr1.status = 'bye';
    sync(structure, rows);
    const { rows: done } = (() => {
      for (;;) {
        const ready = rows.filter((r) => r.status === 'ready');
        if (ready.length === 0) break;
        record(structure, rows, ready[0].matchNumber, favourite(ready[0], Math.random));
      }
      return { rows };
    })();
    assertFinished(structure, done, 5, 2);
  });
});

describe('skill_based seeding', () => {
  const rated = (n: number): CompetitorSeed[] =>
    Array.from({ length: n }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      name: `C${i + 1}`,
      school: `S${i + 1}`,
      skillRating: 2000 - i * 10, // reg-1 is the best
    }));

  for (const n of [4, 5, 7, 8, 12, 16]) {
    it(`N=${n}: top two seeds are in opposite halves and seed 1 plays the lowest seed / bye`, () => {
      const structure = generateSingleElimination(rated(n), 'skill_based');
      const r1 = [...structure.winners, ...structure.finals].filter((m) => m.round === 1);
      const half = r1.length / 2;
      const idx = (id: string) => r1.findIndex((m) => m.competitor1Id === id || m.competitor2Id === id);
      expect(idx('reg-1')).toBeLessThan(half);
      expect(idx('reg-2')).toBeGreaterThanOrEqual(half);
      const m1 = r1[idx('reg-1')];
      const opp = m1.competitor1Id === 'reg-1' ? m1.competitor2Id : m1.competitor1Id;
      const size = r1.length * 2;
      // Seed 1 faces seed `size` — a bye when N < size.
      expect(opp).toBe(size <= n ? `reg-${size}` : null);
      // No seed pair (1,2) in round 1.
      for (const m of r1) {
        expect([m.competitor1Id, m.competitor2Id].sort()).not.toEqual(['reg-1', 'reg-2']);
      }
    });
  }

  it('does not drop or duplicate competitors for any N', () => {
    for (let n = 2; n <= 33; n++) {
      const structure = generateBracket(rated(n), 'skill_based');
      const ids = [...structure.winners, ...structure.finals]
        .filter((m) => m.round === 1)
        .flatMap((m) => [m.competitor1Id, m.competitor2Id])
        .filter(Boolean);
      expect(new Set(ids).size).toBe(n);
    }
  });
});

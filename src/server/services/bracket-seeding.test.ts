import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  beltRankScore,
  drawNumber,
  generateEliminationBracket,
  bracketRulesEnabled,
  loadRuleSeeding,
  generateEliminationFromRules,
  planFirstRound,
  rankCompetitors,
  resolveBracketRules,
  usesTournamentRules,
  withSeedFacts,
} from './bracket-seeding.js';
import {
  generateBracket,
  generateSingleElimination,
  type BracketStructure,
  type CompetitorSeed,
} from './bracket-generator.js';
import { computeBracketSync, isBracketComplete, type EngineMatch } from './match-advancement.js';
import { buildProposedBracketCorrection } from './bracket-correction.js';
import { countSameSchoolFirstRound } from '../../shared/utils/same-school.js';
import { DEFAULT_BRACKET_RULES, type BracketRules } from '../../shared/constants/tournament-rules.js';

// ─── helpers ───────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n competitors, rank i+1 has beltRank n-i (so reg-1 is the top seed). */
function field(n: number, schoolOf: (i: number) => string): CompetitorSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: schoolOf(i),
    beltRank: n - i,
  }));
}

const rules = (overrides: Partial<BracketRules> = {}): BracketRules => ({ ...DEFAULT_BRACKET_RULES, ...overrides });

type Row = EngineMatch & { roundNumber: number };

function toRows(structure: BracketStructure): Row[] {
  const rows: Row[] = [];
  for (const [list, bracketType] of [[structure.winners, 'winners'], [structure.losers, 'losers'], [structure.finals, 'finals']] as const) {
    for (const m of list) {
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
  }
  return rows;
}

function sync(structure: BracketStructure, rows: Row[]) {
  for (const update of computeBracketSync(structure, rows)) {
    Object.assign(rows.find((r) => r.id === update.id)!, update.data);
  }
}

/** Play every ready match (random winner) until nothing is ready. */
function playOut(structure: BracketStructure, seed: number): Row[] {
  const rows = toRows(structure);
  sync(structure, rows);
  const rng = mulberry32(seed);
  for (let guard = 0; guard < 500; guard++) {
    const ready = rows.filter((r) => r.status === 'ready').sort((a, b) => a.matchNumber - b.matchNumber);
    if (ready.length === 0) break;
    const match = ready[Math.floor(rng() * ready.length)];
    match.winnerId = rng() < 0.5 ? match.competitor1Id : match.competitor2Id;
    match.status = 'completed';
    sync(structure, rows);
  }
  return rows;
}

/** Round-1 matches in sheet order (match k = slots 2k, 2k+1). */
function firstRound(structure: BracketStructure) {
  return [...structure.winners, ...structure.finals]
    .filter((m) => m.round === 1)
    .sort((a, b) => a.matchNumber - b.matchNumber);
}

function sameSchoolSummary(structure: BracketStructure, competitors: CompetitorSeed[]) {
  const schoolOf = new Map(competitors.map((c) => [c.registrationId, c.school]));
  return countSameSchoolFirstRound('double_elim', toRows(structure), (id) => schoolOf.get(id))!;
}

// ─── rules parsing ─────────────────────────────────────────────────────

describe('resolveBracketRules', () => {
  it('fills missing and unknown values with the defaults', () => {
    const resolved = resolveBracketRules({
      seedingStrategy: 'elo' as never,
      byePlacement: undefined,
      round1Pairing: 'adjacent',
      avoidSameSchoolRound1: 'yes' as never,
    });
    expect(resolved.seedingStrategy).toBe(DEFAULT_BRACKET_RULES.seedingStrategy);
    expect(resolved.byePlacement).toBe(DEFAULT_BRACKET_RULES.byePlacement);
    expect(resolved.round1Pairing).toBe('adjacent');
    expect(resolved.avoidSameSchoolRound1).toBe(true);
    expect(resolveBracketRules(null)).toEqual(DEFAULT_BRACKET_RULES);
  });

  it('only the app default strategy (school_spread / none) follows the rules', () => {
    expect(usesTournamentRules(undefined)).toBe(true);
    expect(usesTournamentRules('school_spread')).toBe(true);
    expect(usesTournamentRules('manual')).toBe(false);
    expect(usesTournamentRules('skill_based')).toBe(false);
  });
});

// ─── belt rank & ranking ───────────────────────────────────────────────

describe('beltRankScore', () => {
  it('orders colour belts by stripe and black belts by dan above them', () => {
    const order = [
      beltRankScore('White'),
      beltRankScore('Yellow'),
      beltRankScore('Yellow', 'Single Green Stripe'),
      beltRankScore('Yellow / Double Green Stripe'),
      beltRankScore('Green'),
      beltRankScore('Red', 'Double Black Stripe'),
      beltRankScore('Black', null, 1),
      beltRankScore('black', null, 3),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(beltRankScore('')).toBe(-1);
    expect(beltRankScore('Purple')).toBe(-1);
  });
});

describe('rankCompetitors', () => {
  const base = (id: string, extra: Partial<CompetitorSeed>): CompetitorSeed => ({ registrationId: id, name: id, school: '', ...extra });

  it('puts director-set seeds first, then the chosen measure, then belt', () => {
    const list = [
      base('a', { skillRating: 1500, beltRank: 1 }),
      base('b', { skillRating: 1200, beltRank: 9 }),
      base('c', { beltRank: 12 }),
      base('d', { manualSeed: 1, beltRank: 0 }),
    ];
    expect(rankCompetitors(list, 'rating', 'k').map((c) => c.registrationId)).toEqual(['d', 'a', 'b', 'c']);
    expect(rankCompetitors(list, 'belt', 'k').map((c) => c.registrationId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('seeds by years of training, belt rank breaking ties', () => {
    const list = [
      base('a', { experienceScore: 2, beltRank: 1 }),
      base('b', { experienceScore: 6, beltRank: 1 }),
      base('c', { experienceScore: 2, beltRank: 5 }),
    ];
    expect(rankCompetitors(list, 'experience', 'k').map((c) => c.registrationId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties with a draw that does not depend on input order or names', () => {
    const list = Array.from({ length: 12 }, (_, i) => base(`r${i}`, { name: `Name ${String.fromCharCode(65 + i)}`, beltRank: 3 }));
    const first = rankCompetitors(list, 'belt', 'division-1').map((c) => c.registrationId);
    const reversed = rankCompetitors([...list].reverse(), 'belt', 'division-1').map((c) => c.registrationId);
    expect(reversed).toEqual(first);
    // Not alphabetical, and a different division draws differently.
    expect(first).not.toEqual(list.map((c) => c.registrationId));
    expect(rankCompetitors(list, 'belt', 'division-2').map((c) => c.registrationId)).not.toEqual(first);
  });

  it('random ignores belt rank', () => {
    const list = Array.from({ length: 10 }, (_, i) => base(`r${i}`, { beltRank: i }));
    const byDraw = [...list].sort((a, b) => drawNumber(`k:${a.registrationId}`) - drawNumber(`k:${b.registrationId}`));
    expect(rankCompetitors(list, 'random', 'k')).toEqual(byDraw);
  });
});

// ─── school separation ────────────────────────────────────────────────

describe('avoid same school in round 1', () => {
  // School mixes from "everyone different" to "one school is most of
  // the division", plus random mixes.
  const mixes: Array<[string, (n: number) => (i: number) => string]> = [
    ['all different', () => (i) => `School ${i}`],
    ['two schools alternating', () => (i) => (i % 2 === 0 ? 'Newtons TKD' : 'Tiger Dojang')],
    ['two schools in blocks', (n) => (i) => (i < n / 2 ? 'Newtons TKD' : 'Tiger Dojang')],
    ['one big school', (n) => (i) => (i < Math.ceil(n * 0.7) ? 'Newtons TKD' : `Small ${i}`)],
    ['everyone from one school', () => () => 'Newtons TKD'],
    ['host school 1 in 3', () => (i) => (i % 3 === 0 ? 'Newtons TKD' : `Club ${i % 4}`)],
  ];

  for (let n = 2; n <= 16; n++) {
    for (const [name, mix] of mixes) {
      it(`N=${n}, ${name}: fewest possible team-mate fights, everyone placed once`, () => {
        const competitors = field(n, mix(n));
        for (const format of ['double_elim', 'single_elim'] as const) {
          const structure = generateEliminationFromRules(competitors, format, rules(), 'div-1');
          const summary = sameSchoolSummary(structure, competitors);
          expect(summary.count).toBe(summary.unavoidable);
          expect(structure.seedingInfo?.sameSchoolFirstRound).toBe(summary.count);

          const placed = firstRound(structure).flatMap((m) => [m.competitor1Id, m.competitor2Id]).filter(Boolean);
          expect(new Set(placed).size).toBe(n);
          expect(placed).toHaveLength(n);
        }
      });
    }

    it(`N=${n}, random mixes of 1-4 schools reach the minimum`, () => {
      const rng = mulberry32(n * 101);
      for (let trial = 0; trial < 25; trial++) {
        const schoolCount = 1 + Math.floor(rng() * 4);
        const schools = Array.from({ length: n }, () => `S${Math.floor(rng() * schoolCount)}`);
        const competitors = field(n, (i) => schools[i]);
        for (const r1 of ['split', 'balanced', 'adjacent'] as const) {
          for (const bye of ['rating', 'top', 'random'] as const) {
            const structure = generateEliminationFromRules(
              competitors, 'double_elim', rules({ round1Pairing: r1, byePlacement: bye }), `t${trial}`,
            );
            const summary = sameSchoolSummary(structure, competitors);
            expect(summary.count, `${r1}/${bye} ${schools.join(',')}`).toBe(summary.unavoidable);
          }
        }
      }
    });
  }

  it('keeps the seeding when there is nothing to fix', () => {
    const competitors = field(8, (i) => `School ${i}`);
    const plan = planFirstRound(competitors, rules(), 'k');
    const pairs = [];
    for (let i = 0; i < plan.slots.length; i += 2) pairs.push([plan.slots[i]!.registrationId, plan.slots[i + 1]!.registrationId]);
    expect(pairs).toEqual([['reg-1', 'reg-8'], ['reg-4', 'reg-5'], ['reg-2', 'reg-7'], ['reg-3', 'reg-6']]);
  });

  it('swaps with the closest-ranked competitor', () => {
    // 1 v 8 are team-mates: the fix swaps 8 with 7 (2 v 7 becomes 2 v 8).
    const schools = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A'];
    const competitors = field(8, (i) => schools[i]);
    const plan = planFirstRound(competitors, rules(), 'k');
    expect(plan.sameSchoolFights).toBe(0);
    const opponent = (id: string) => {
      const i = plan.slots.findIndex((c) => c?.registrationId === id);
      return plan.slots[i % 2 === 0 ? i + 1 : i - 1]?.registrationId;
    };
    expect(opponent('reg-1')).toBe('reg-7');
    expect(opponent('reg-2')).toBe('reg-8');
    expect(opponent('reg-3')).toBe('reg-6');
  });

  it('when switched off, team-mates can meet in round 1', () => {
    const competitors = field(8, (i) => (i < 4 ? 'A' : 'B'));
    const off = generateEliminationFromRules(competitors, 'double_elim', rules({ avoidSameSchoolRound1: false, round1Pairing: 'adjacent' }), 'k');
    const on = generateEliminationFromRules(competitors, 'double_elim', rules({ round1Pairing: 'adjacent' }), 'k');
    expect(sameSchoolSummary(off, competitors).count).toBe(4);
    expect(sameSchoolSummary(on, competitors).count).toBe(0);
  });

  it('blank schools are never treated as team-mates', () => {
    const competitors = field(8, () => '  ');
    const plan = planFirstRound(competitors, rules(), 'k');
    expect(plan.sameSchoolFights).toBe(0);
  });

  it('school names match ignoring case and extra spaces', () => {
    const competitors = field(4, (i) => (i % 2 === 0 ? 'Newtons  TKD' : ' newtons tkd'));
    const off = planFirstRound(competitors, rules({ avoidSameSchoolRound1: false }), 'k');
    expect(off.sameSchoolFights).toBe(2);
  });
});

// ─── byes ─────────────────────────────────────────────────────────────

describe('bye placement', () => {
  const byeReceivers = (structure: BracketStructure) =>
    firstRound(structure)
      .filter((m) => !m.competitor1Id || !m.competitor2Id)
      .map((m) => (m.competitor1Id ?? m.competitor2Id)!);

  for (let n = 3; n <= 16; n++) {
    const size = 2 ** Math.ceil(Math.log2(n));
    const byes = size - n;
    if (byes === 0) continue;

    it(`N=${n}: top seeds get the ${byes} bye(s), spread across the bracket`, () => {
      const competitors = field(n, (i) => `School ${i}`);
      const structure = generateEliminationFromRules(competitors, 'double_elim', rules({ byePlacement: 'rating' }), 'k');
      const expected = Array.from({ length: byes }, (_, i) => `reg-${i + 1}`);
      expect(byeReceivers(structure).sort()).toEqual(expected.sort());
      // Same layout as the long-standing standard seeding.
      const standard = generateBracket(competitors, 'manual');
      expect(firstRound(structure)).toEqual(firstRound(standard));
    });

    it(`N=${n}: byes at the top of the sheet fill the first matches`, () => {
      const competitors = field(n, (i) => `School ${i}`);
      const structure = generateEliminationFromRules(competitors, 'double_elim', rules({ byePlacement: 'top' }), 'k');
      const r1 = firstRound(structure);
      r1.forEach((m, i) => {
        const isBye = !m.competitor1Id || !m.competitor2Id;
        expect(isBye).toBe(i < byes);
      });
      expect(byeReceivers(structure).sort()).toEqual(Array.from({ length: byes }, (_, i) => `reg-${i + 1}`).sort());
    });

    it(`N=${n}: random byes are a fixed draw per division`, () => {
      const competitors = field(n, (i) => `School ${i}`);
      const a = generateEliminationFromRules(competitors, 'double_elim', rules({ byePlacement: 'random' }), 'division-a');
      const again = generateEliminationFromRules(competitors, 'double_elim', rules({ byePlacement: 'random' }), 'division-a');
      expect(byeReceivers(a)).toHaveLength(byes);
      expect(again).toEqual(a);
    });
  }

  it('random byes differ between divisions', () => {
    const competitors = field(9, (i) => `School ${i}`);
    const draws = new Set(
      ['d1', 'd2', 'd3', 'd4', 'd5'].map((key) =>
        byeReceivers(generateEliminationFromRules(competitors, 'double_elim', rules({ byePlacement: 'random' }), key)).sort().join(',')),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it('a bye never faces another bye', () => {
    for (let n = 2; n <= 33; n++) {
      for (const bye of ['rating', 'top', 'random'] as const) {
        const structure = generateEliminationFromRules(field(n, () => 'A'), 'single_elim', rules({ byePlacement: bye }), 'k');
        for (const m of firstRound(structure)) expect(m.competitor1Id || m.competitor2Id).toBeTruthy();
      }
    }
  });
});

// ─── round-1 pairing ──────────────────────────────────────────────────

describe('round 1 pairing', () => {
  const pairsOf = (structure: BracketStructure) =>
    firstRound(structure).map((m) => [m.competitor1Id, m.competitor2Id].map((id) => Number(id!.split('-')[1])).sort((a, b) => a - b));

  const competitors = field(8, (i) => `School ${i}`);

  it('split (standard): 1 v 8, 2 v 7 and seeds 1 and 2 in opposite halves', () => {
    const pairs = pairsOf(generateEliminationFromRules(competitors, 'double_elim', rules({ round1Pairing: 'split' }), 'k'));
    expect(pairs).toEqual([[1, 8], [4, 5], [2, 7], [3, 6]]);
  });

  it('balanced: top half meets bottom half (1 v 5, 2 v 6)', () => {
    const pairs = pairsOf(generateEliminationFromRules(competitors, 'double_elim', rules({ round1Pairing: 'balanced' }), 'k'));
    expect(pairs).toEqual([[1, 5], [4, 8], [2, 6], [3, 7]]);
  });

  it('adjacent: similar strength first (1 v 2, 3 v 4)', () => {
    const pairs = pairsOf(generateEliminationFromRules(competitors, 'double_elim', rules({ round1Pairing: 'adjacent' }), 'k'));
    expect(pairs).toEqual([[1, 2], [7, 8], [3, 4], [5, 6]]);
  });
});

// ─── structure contract & determinism ────────────────────────────────

describe('structure contract', () => {
  for (let n = 0; n <= 20; n++) {
    it(`N=${n}: same matches and positions as the plain generators`, () => {
      const competitors = field(n, (i) => (i % 3 === 0 ? 'A' : `B${i}`));
      for (const bye of ['rating', 'top', 'random'] as const) {
        const de = generateEliminationFromRules(competitors, 'double_elim', rules({ byePlacement: bye }), 'k');
        const plainDe = generateBracket(field(n, () => ''), 'manual');
        expect(de.positions).toEqual(plainDe.positions);
        const shape = (s: BracketStructure) => [...s.winners, ...s.losers, ...s.finals]
          .map((m) => [m.matchNumber, m.round, m.nextWinnerMatch ?? null, m.nextLoserMatch ?? null]);
        expect(shape(de)).toEqual(shape(plainDe));

        const se = generateEliminationFromRules(competitors, 'single_elim', rules({ byePlacement: bye }), 'k');
        const plainSe = generateSingleElimination(field(n, () => ''), 'manual');
        expect(se.positions).toEqual(plainSe.positions);
        expect(shape(se)).toEqual(shape(plainSe));
      }
    });
  }

  it('is deterministic whatever order the competitors arrive in', () => {
    const rng = mulberry32(7);
    for (let n = 2; n <= 16; n++) {
      const competitors = field(n, (i) => `S${i % 3}`).map((c) => ({ ...c, beltRank: 1 }));
      const shuffled = [...competitors].sort(() => rng() - 0.5);
      for (const seedBy of ['rating', 'experience', 'belt', 'random'] as const) {
        const r = rules({ seedingStrategy: seedBy, byePlacement: 'random' });
        expect(generateEliminationFromRules(shuffled, 'double_elim', r, 'div')).toEqual(
          generateEliminationFromRules(competitors, 'double_elim', r, 'div'),
        );
      }
    }
  });
});

describe('every rules-seeded bracket can be played to the end', () => {
  for (let n = 2; n <= 17; n++) {
    it(`N=${n}`, () => {
      const competitors = field(n, (i) => `S${i % 3}`);
      for (const format of ['double_elim', 'single_elim'] as const) {
        for (const bye of ['rating', 'top', 'random'] as const) {
          for (const r1 of ['split', 'balanced', 'adjacent'] as const) {
            const structure = generateEliminationFromRules(competitors, format, rules({ byePlacement: bye, round1Pairing: r1 }), 'k');
            const rows = playOut(structure, n * 13 + 1);
            expect(isBracketComplete(rows, structure), `${format} ${bye} ${r1}`).toBe(true);
          }
        }
      }
    });
  }
});

describe('withSeedFacts', () => {
  it('merges loaded facts by registration id', () => {
    const merged = withSeedFacts(
      [{ registrationId: 'r1', name: 'A', school: 'X' }, { registrationId: 'r2', name: 'B', school: 'Y' }],
      new Map([['r1', { beltRank: 4, manualSeed: 2 }]]),
    );
    expect(merged[0]).toMatchObject({ registrationId: 'r1', beltRank: 4, manualSeed: 2 });
    expect(merged[1]).toEqual({ registrationId: 'r2', name: 'B', school: 'Y' });
  });
});

// ─── no saved rules: nothing changes ─────────────────────────────────

describe('without the bracket-rules switch on, brackets are made as before', () => {
  // sha256 (first 16 hex) of JSON.stringify of the generator output on
  // origin/main before the bracket rules were used (generateBracket /
  // generateSingleElimination with 'school_spread'), for this fixture.
  const SCHOOLS = ['Newtons TKD', 'Tiger Dojang', 'Newtons TKD', 'Dragon Club', 'Newtons TKD', '', 'Tiger Dojang'];
  const fixture = (n: number): CompetitorSeed[] => Array.from({ length: n }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: SCHOOLS[(i * 5 + n) % SCHOOLS.length],
    seedPosition: i + 1,
  }));
  const PRE_CHANGE: Record<number, [de: string, se: string]> = {
    2: ['d596a9ecb8545f4a', 'a4b303d35b6706eb'],
    3: ['87437b6f0599ba3d', '4b70387f282cc981'],
    4: ['bedabf9635c4d561', '6c8887db18fb9889'],
    5: ['e17b982843718f56', '467a5a600f113585'],
    6: ['7215d8ae5998e911', '34ddc53360e4d5b5'],
    7: ['6153db413f40bec5', '2d5c1a14ccae834d'],
    8: ['f10da0565d0d890b', '279b9958e6452399'],
    9: ['ff94c5fcf4cce2f4', 'fbb3b29c4cc4228b'],
    10: ['35e8d2668f357ae4', '14c8b2933639f9af'],
    11: ['1df090eb6373b5d2', 'e44a0c65f0435e8e'],
    12: ['1584515df71f0d7e', '320f17622c9996c4'],
    13: ['1302039fba1bd3ca', '04848a9d429eb672'],
    14: ['c58fdf91a94a8aa8', '3218bce4e0f6e53b'],
    15: ['c9aab6743a11e7d2', '96ddbaffbf7b7802'],
    16: ['68cd966d5e034cda', '3ea29092ab420683'],
    17: ['c921cbc93e4928a9', 'b97492c9993e0faa'],
  };
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

  /** A fake database: one division whose tournament has `settings`. */
  const fakeDb = (settings: string | null, n: number) => ({
    division: {
      findUnique: async () => ({
        id: 'div',
        eventType: 'sparring',
        tournament: { settings },
        assignments: fixture(n).map((c, i) => ({
          registrationId: c.registrationId,
          registration: {
            seeding: null,
            experienceScore: null,
            competitor: { id: `c${i}`, belt: 'Blue', beltStripe: null, danRank: null, yearsTraining: null },
          },
        })),
      }),
    },
    competitorRating: { findMany: async () => [] },
  }) as never;

  // Saved rules from before the switch existed (full rule set, no
  // applySeedingRules), with it off, or with a non-boolean value.
  const savedSwitchOff = JSON.stringify({ brackets: { ...DEFAULT_BRACKET_RULES, round1Pairing: 'adjacent', byePlacement: 'top' } });
  const savedLegacy = (() => {
    const { applySeedingRules: _ignored, ...legacy } = { ...DEFAULT_BRACKET_RULES, seedingStrategy: 'random' as const };
    return JSON.stringify({ brackets: legacy, weights: { strategy: 'standard' } });
  })();
  const savedTruthyString = JSON.stringify({ brackets: { applySeedingRules: 'true', round1Pairing: 'adjacent' } });
  const switchOn = JSON.stringify({ brackets: { applySeedingRules: true, round1Pairing: 'adjacent' } });

  it('only an explicit switch-on enables the bracket rules', () => {
    expect(bracketRulesEnabled(null)).toBe(false);
    expect(bracketRulesEnabled('')).toBe(false);
    expect(bracketRulesEnabled('not json')).toBe(false);
    expect(bracketRulesEnabled('{}')).toBe(false);
    expect(bracketRulesEnabled(JSON.stringify({ weights: { strategy: 'standard' }, publicSlug: 'x' }))).toBe(false);
    expect(bracketRulesEnabled(JSON.stringify({ brackets: null }))).toBe(false);
    expect(bracketRulesEnabled(JSON.stringify({ brackets: DEFAULT_BRACKET_RULES }))).toBe(false);
    expect(bracketRulesEnabled(savedSwitchOff)).toBe(false);
    expect(bracketRulesEnabled(savedLegacy)).toBe(false);
    expect(bracketRulesEnabled(savedTruthyString)).toBe(false);
    expect(bracketRulesEnabled(switchOn)).toBe(true);
    expect(DEFAULT_BRACKET_RULES.applySeedingRules).toBe(false);
  });

  for (let n = 2; n <= 17; n++) {
    it(`N=${n}: generate and reseed give the pre-change layout byte for byte`, async () => {
      for (const settings of [null, '{}', JSON.stringify({ divisions: { minDivisionSize: 3 } }), savedSwitchOff, savedLegacy, savedTruthyString]) {
        const seeding = await loadRuleSeeding(fakeDb(settings, n), 'div');
        expect(seeding).toBeNull();
        // generate / generate-all
        const de = generateEliminationBracket(fixture(n), 'double_elim', 'school_spread', seeding);
        const se = generateEliminationBracket(fixture(n), 'single_elim', 'school_spread', seeding);
        expect([hash(de), hash(se)]).toEqual(PRE_CHANGE[n]);
        // reseed (correction preview / apply)
        const snapshot = {
          tournamentId: 't', divisionId: 'div', divisionName: 'D', bracket: null,
          matchAuditCount: 0, matchupHistoryCount: 0, matchAuditRows: [], matchupHistoryRows: [],
          assignments: fixture(n).map((c) => ({
            registrationId: c.registrationId, seedPosition: c.seedPosition ?? null,
            firstName: c.name.split(' ')[0], lastName: c.name.split(' ')[1], school: c.school,
          })),
        };
        expect(hash(buildProposedBracketCorrection(snapshot, { format: 'double_elim', seedingStrategy: 'school_spread' }, seeding).structure))
          .toBe(PRE_CHANGE[n][0]);
        expect(hash(buildProposedBracketCorrection(snapshot, { format: 'single_elim', seedingStrategy: 'school_spread' }, seeding).structure))
          .toBe(PRE_CHANGE[n][1]);
      }
    });
  }

  it('the switch turns the new seeding on', async () => {
    const seeding = await loadRuleSeeding(fakeDb(switchOn, 8), 'div');
    expect(seeding?.rules.round1Pairing).toBe('adjacent');
    const structure = generateEliminationBracket(fixture(8), 'double_elim', 'school_spread', seeding);
    expect(structure.seedingInfo?.strategy).toBe('tournament_rules');
    // A named strategy other than the app default still bypasses the rules.
    expect(generateEliminationBracket(fixture(8), 'double_elim', 'manual', seeding).seedingInfo?.strategy).toBe('manual');
  });
});

describe('bracket corrections (reseed) follow the rules too', () => {
  const assignments = Array.from({ length: 8 }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    seedPosition: i + 1,
    firstName: `F${i + 1}`,
    lastName: 'L',
    school: i < 4 ? 'A' : 'B',
  }));
  const snapshot = {
    tournamentId: 't', divisionId: 'div', divisionName: 'D', assignments, bracket: null,
    matchAuditCount: 0, matchupHistoryCount: 0, matchAuditRows: [], matchupHistoryRows: [],
  };
  const facts = new Map(assignments.map((a, i) => [a.registrationId, { beltRank: 8 - i }]));

  it('uses the rules when given and the app default strategy is asked for', () => {
    const seeding = { rules: rules({ round1Pairing: 'adjacent' }), drawKey: 'div', facts };
    const config = { format: 'double_elim', seedingStrategy: 'school_spread' } as const;
    const proposal = buildProposedBracketCorrection(snapshot, config, seeding);
    const expected = generateEliminationFromRules(withSeedFacts(assignments.map((a) => ({
      registrationId: a.registrationId, name: `${a.firstName} ${a.lastName}`, school: a.school, seedPosition: a.seedPosition,
    })), facts), 'double_elim', seeding.rules, 'div');
    expect(proposal.structure).toEqual(expected);
    expect(sameSchoolSummary(proposal.structure!, assignments.map((a) => ({ registrationId: a.registrationId, name: '', school: a.school }))).count).toBe(0);
    // Deterministic: preview and apply build the same proposal.
    expect(buildProposedBracketCorrection(snapshot, config, seeding)).toEqual(proposal);
    // Without seeding input the long-standing strategy is used.
    expect(buildProposedBracketCorrection(snapshot, config).structure?.seedingInfo?.strategy).toBe('school_spread');
  });
});

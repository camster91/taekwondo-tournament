// Round-Robin and Pool-Play bracket generator
//
// A real tournament manager's most common ask: "we have 4-5 kids in this
// division, a double-elim bracket would mean half of them get a bye
// and the rest play once then are eliminated. Run a round-robin."
//
// Round-robin = every competitor plays every other competitor once.
// Best for 3-5 competitor divisions.
//
// Pool play = split into pools of ~4, round-robin within each pool,
// then a final bracket across pool winners. Best for 6-12 competitor
// divisions.

import type { CompetitorSeed, MatchData, BracketStructure, SeedingConfig, SeedingStrategy } from './bracket-generator.js';

export type RoundRobinPlacement = 'wins' | 'h2h' | 'points' | 'rating';

/**
 * Generate a round-robin schedule.
 * n competitors → n(n-1)/2 matches. Uses the "circle method" so each
 * round has at most ⌈n/2⌉ matches and every competitor plays once per round.
 */
export function generateRoundRobin(
  competitors: CompetitorSeed[],
  config?: { seedingStrategy?: SeedingStrategy; seedingConfig?: Partial<SeedingConfig> }
): BracketStructure {
  const count = competitors.length;
  if (count < 2) {
    return {
      winners: [],
      losers: [],
      finals: [],
      competitorCount: count,
      seedingInfo: { strategy: 'random', skillBalance: 100, schoolDiversity: 100 },
    };
  }

  // Apply the same seeding strategies as the double-elim generator so
  // pool assignments are fair (avoid same-school in same pool)
  const strategy = config?.seedingStrategy ?? 'school_spread';
  const sorted = applySeeding(competitors, strategy, config?.seedingConfig);

  // Circle method: fix competitor 0 in position, rotate the rest
  const ids = sorted.map((c) => c.registrationId);
  const n = ids.length;
  const rounds: MatchData[][] = [];
  let matchNumber = 1;

  // If odd, add a "BYE" placeholder that never gets paired
  const isOdd = n % 2 === 1;
  const players: (string | null)[] = [...ids];
  if (isOdd) players.push(null); // bye

  for (let r = 0; r < players.length - 1; r++) {
    const roundMatches: MatchData[] = [];
    for (let i = 0; i < players.length / 2; i++) {
      const home = players[i];
      const away = players[players.length - 1 - i];
      // Skip BYE matches — competitor wins by default
      if (home && away) {
        roundMatches.push({
          matchNumber: matchNumber++,
          round: r + 1,
          competitor1Id: home,
          competitor2Id: away,
        });
      }
    }
    rounds.push(roundMatches);

    // Rotate everyone except position 0
    const fixed = players[0];
    const rest = players.slice(1);
    rest.unshift(rest.pop()!);
    players.splice(0, players.length, fixed, ...rest);
  }

  const allMatches = rounds.flat();

  return {
    winners: allMatches,
    losers: [],
    finals: [],
    competitorCount: count,
    seedingInfo: {
      strategy,
      skillBalance: computeBalance(sorted),
      schoolDiversity: computeSchoolDiversity(sorted),
    },
  };
}

/**
 * Pool play: split N competitors into ~P pools of ~S each, run a
 * round-robin within each pool, then a single-elim bracket of pool
 * winners (with wildcards for 2nd-place finishers if pools are uneven).
 */
export function generatePoolPlay(
  competitors: CompetitorSeed[],
  options?: {
    poolCount?: number;
    poolSize?: number;          // target competitors per pool
    seedingStrategy?: SeedingStrategy;
    seedingConfig?: Partial<SeedingConfig>;
    advancePerPool?: number;    // how many advance from each pool (default 2)
  }
): BracketStructure {
  const count = competitors.length;
  if (count < 4) {
    // Too small for pool play, fall back to round-robin
    return generateRoundRobin(competitors, options);
  }

  // Decide pool count
  let poolCount = options?.poolCount ?? 0;
  if (!poolCount && options?.poolSize) {
    poolCount = Math.max(2, Math.ceil(count / options.poolSize));
  }
  if (!poolCount) {
    // Default heuristic: ~4 per pool
    if (count <= 9) poolCount = 2;
    else if (count <= 12) poolCount = 3;
    else poolCount = 4;
  }

  const advancePerPool = options?.advancePerPool ?? 2;
  const strategy = options?.seedingStrategy ?? 'school_spread';
  const sorted = applySeeding(competitors, strategy, options?.seedingConfig);

  // Snake-seed: assign to pools so each pool has roughly equal skill
  // and schools are spread across pools
  const pools: CompetitorSeed[][] = Array.from({ length: poolCount }, () => []);
  for (let i = 0; i < sorted.length; i++) {
    // Snake order: 0→pool0, 1→pool1, 2→pool2, 3→pool2, 4→pool1, 5→pool0 (repeat)
    const round = Math.floor(i / poolCount);
    const slotInRound = i % poolCount;
    const poolIdx = round % 2 === 0 ? slotInRound : poolCount - 1 - slotInRound;
    pools[poolIdx].push(sorted[i]);
  }

  // Generate round-robin within each pool
  let matchNumber = 1;
  const poolWinners: (CompetitorSeed | null)[] = []; // for the final bracket
  const allMatches: MatchData[] = [];

  for (let p = 0; p < pools.length; p++) {
    const pool = pools[p];
    if (pool.length < 2) {
      // 1-person pool: that person auto-advances
      if (pool[0]) poolWinners.push(pool[0]);
      continue;
    }

    // Mini round-robin for this pool
    const subBracket = generateRoundRobin(pool, { seedingStrategy: 'manual', seedingConfig: {} });
    // Renumber match IDs and add pool tag to round (offset rounds by 1000 per pool)
    for (const m of subBracket.winners) {
      allMatches.push({
        matchNumber: matchNumber++,
        round: 1000 + p * 100 + m.round, // round codes: 1001-1099 for pool 0
        competitor1Id: m.competitor1Id,
        competitor2Id: m.competitor2Id,
      });
    }

    // For now, just track that the top N per pool advance. The actual
    // advancement is decided by the scorekeeper recording results; this
    // method just creates the pool stage matches. The final bracket is
    // a separate flow.
  }

  return {
    winners: allMatches,
    losers: [],
    finals: [], // Pool-play finals are created on demand after pool stage completes
    competitorCount: count,
    seedingInfo: {
      strategy,
      skillBalance: computeBalance(sorted),
      schoolDiversity: computePoolSchoolDiversity(pools),
    },
  };
}

// ─── Helpers (mirror the ones in bracket-generator.ts but kept local so
//    this file is self-contained) ────────────────────────────────────

function applySeeding(
  competitors: CompetitorSeed[],
  strategy: SeedingStrategy,
  config?: Partial<SeedingConfig>
): CompetitorSeed[] {
  switch (strategy) {
    case 'random':
      return [...competitors].sort(() => Math.random() - 0.5);
    case 'manual':
      return [...competitors].sort((a, b) => (a.seedPosition || 99) - (b.seedPosition || 99));
    case 'skill_based':
    case 'balanced':
    case 'fairness_optimized':
      return [...competitors].sort((a, b) => (b.skillRating || 0) - (a.skillRating || 0));
    case 'school_spread':
    default: {
      // School-aware interleaving: avoid putting two of the same school adjacent
      const sorted = [...competitors].sort((a, b) => (b.skillRating || 0) - (a.skillRating || 0));
      const result: CompetitorSeed[] = [];
      const remaining = [...sorted];
      while (remaining.length > 0) {
        const lastSchool = result[result.length - 1]?.school;
        // Find first competitor whose school differs from last placed
        let pickIdx = remaining.findIndex((c) => c.school !== lastSchool);
        if (pickIdx === -1) pickIdx = 0; // all same school as last — accept it
        result.push(remaining.splice(pickIdx, 1)[0]);
      }
      return result;
    }
  }
}

function computeBalance(sorted: CompetitorSeed[]): number {
  const midpoint = Math.floor(sorted.length / 2);
  const left = sorted.slice(0, midpoint).reduce((s, c) => s + (c?.skillRating || 0), 0);
  const right = sorted.slice(midpoint).reduce((s, c) => s + (c?.skillRating || 0), 0);
  const total = left + right;
  return total > 0 ? Math.round((1 - Math.abs(left - right) / total) * 100) : 100;
}

function computeSchoolDiversity(sorted: CompetitorSeed[]): number {
  const total = sorted.length;
  if (total < 2) return 100;
  const sameSchoolPairs = total - new Set(sorted.map((c) => c.school)).size;
  return Math.max(0, Math.round((1 - sameSchoolPairs / total) * 100));
}

function computePoolSchoolDiversity(pools: CompetitorSeed[][]): number {
  let total = 0;
  let mixed = 0;
  for (const pool of pools) {
    total += pool.length;
    if (pool.length > 1) {
      const schools = new Set(pool.map((c) => c.school));
      if (schools.size > 1) mixed += pool.length;
    }
  }
  return total > 0 ? Math.round((mixed / total) * 100) : 100;
}

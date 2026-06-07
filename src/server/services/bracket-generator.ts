// 8-person double elimination bracket generator with advanced seeding

export interface CompetitorSeed {
  registrationId: string;
  competitorId?: string;
  name: string;
  school: string;
  seedPosition?: number | null;
  // Enhanced fields for advanced seeding
  skillRating?: number;
  experienceScore?: number;
  weight?: number;
  height?: number;
  region?: string;
  recentOpponents?: string[];
}

export interface MatchData {
  matchNumber: number;
  round: number;
  competitor1Id: string | null;
  competitor2Id: string | null;
  nextWinnerMatch?: number;
  nextLoserMatch?: number;
}

export interface BracketStructure {
  winners: MatchData[];
  losers: MatchData[];
  finals: MatchData[];
  competitorCount: number;
  seedingInfo?: {
    strategy: SeedingStrategy;
    skillBalance: number;
    schoolDiversity: number;
  };
}

export interface SeedingConfig {
  strategy: SeedingStrategy;
  avoidRecentMatchups: boolean;
  recentMatchupTournaments: number;
  regionDiversity: boolean;
  skillBalanceWeight: number; // 0-1
}

export type SeedingStrategy =
  | 'random'
  | 'school_spread'
  | 'manual'
  | 'skill_based'      // ATP/WTA style seeding by rating
  | 'balanced'         // Balance skill across bracket halves
  | 'fairness_optimized'; // Maximize first-round matchup quality

export function generateBracket(
  competitors: CompetitorSeed[],
  strategy: SeedingStrategy = 'school_spread',
  config?: Partial<SeedingConfig>
): BracketStructure {
  const count = competitors.length;

  if (count === 0) {
    return { winners: [], losers: [], finals: [], competitorCount: 0 };
  }

  if (count === 1) {
    // Single competitor - they win by default
    return {
      winners: [
        {
          matchNumber: 1,
          round: 1,
          competitor1Id: competitors[0].registrationId,
          competitor2Id: null,
        },
      ],
      losers: [],
      finals: [],
      competitorCount: 1,
    };
  }

  // Apply seeding strategy
  const seeded = applySeedingStrategy(competitors, strategy, config);

  // Pad to power of 2
  const bracketSize = nextPowerOf2(count);
  const padded = padWithByes(seeded, bracketSize);

  // Calculate seeding quality metrics
  const seedingInfo = calculateSeedingMetrics(seeded, strategy);

  // Generate bracket structure
  let bracket: BracketStructure;
  if (bracketSize <= 4) {
    bracket = generateSmallBracket(padded);
  } else {
    bracket = generateDoubleEliminationBracket(padded);
  }

  bracket.seedingInfo = seedingInfo;
  return bracket;
}

/**
 * Calculate metrics about the seeding quality
 */
function calculateSeedingMetrics(
  seeded: CompetitorSeed[],
  strategy: SeedingStrategy
): BracketStructure['seedingInfo'] {
  // Calculate skill balance
  const midpoint = Math.floor(seeded.length / 2);
  const leftSkill = seeded.slice(0, midpoint).reduce((sum, c) => sum + (c?.skillRating || 0), 0);
  const rightSkill = seeded.slice(midpoint).reduce((sum, c) => sum + (c?.skillRating || 0), 0);
  const totalSkill = leftSkill + rightSkill;
  const skillBalance = totalSkill > 0
    ? Math.round((1 - Math.abs(leftSkill - rightSkill) / totalSkill) * 100)
    : 100;

  // Calculate school diversity in first round
  const pairs = getFirstRoundPairs(seeded.length);
  let sameSchoolPairs = 0;
  for (const [pos1, pos2] of pairs) {
    if (pos1 < seeded.length && pos2 < seeded.length) {
      if (seeded[pos1]?.school === seeded[pos2]?.school) {
        sameSchoolPairs++;
      }
    }
  }
  const schoolDiversity = pairs.length > 0
    ? Math.round((1 - sameSchoolPairs / pairs.length) * 100)
    : 100;

  return {
    strategy,
    skillBalance,
    schoolDiversity,
  };
}

function applySeedingStrategy(
  competitors: CompetitorSeed[],
  strategy: SeedingStrategy,
  config?: Partial<SeedingConfig>
): CompetitorSeed[] {
  switch (strategy) {
    case 'manual':
      // Use existing seed positions
      return [...competitors].sort((a, b) => (a.seedPosition || 99) - (b.seedPosition || 99));

    case 'school_spread':
      // Distribute same-school competitors to minimize first-round matchups
      return distributeBySchool(competitors);

    case 'skill_based':
      // ATP/WTA style - highest rated at top seed positions
      return seedBySkill(competitors);

    case 'balanced':
      // Balance skill across bracket halves
      return seedForBalance(competitors);

    case 'fairness_optimized':
      // Maximize first-round matchup fairness
      return seedForFairness(competitors, config);

    case 'random':
    default:
      return shuffle(competitors);
  }
}

/**
 * Skill-based seeding (like ATP/WTA rankings)
 * Top seeds placed to meet only in later rounds
 */
function seedBySkill(competitors: CompetitorSeed[]): CompetitorSeed[] {
  if (competitors.length <= 2) return competitors;

  // Sort by skill rating (highest first)
  const sorted = [...competitors].sort(
    (a, b) => (b.skillRating || 0) - (a.skillRating || 0)
  );

  // Standard 8-person seeding positions:
  // Seed 1 at position 0, Seed 2 at position 7 (opposite side)
  // Seeds 3-4 at positions 3,4 (quarter-final opponents for seeds 1,2)
  // Seeds 5-8 fill remaining positions
  const seedOrder = [0, 7, 3, 4, 1, 6, 2, 5];

  const bracketSize = nextPowerOf2(competitors.length);
  const result: (CompetitorSeed | null)[] = new Array(bracketSize).fill(null);

  for (let i = 0; i < sorted.length && i < seedOrder.length; i++) {
    const targetPos = seedOrder[i];
    if (targetPos < result.length) {
      result[targetPos] = { ...sorted[i], seedPosition: i + 1 };
    }
  }

  // Handle competitors beyond standard seed positions
  if (sorted.length > seedOrder.length) {
    let nextEmptyIdx = 0;
    for (let i = seedOrder.length; i < sorted.length; i++) {
      while (nextEmptyIdx < result.length && result[nextEmptyIdx] !== null) {
        nextEmptyIdx++;
      }
      if (nextEmptyIdx < result.length) {
        result[nextEmptyIdx] = { ...sorted[i], seedPosition: i + 1 };
      } else {
        result.push({ ...sorted[i], seedPosition: i + 1 });
      }
    }
  }

  return result.filter((c): c is CompetitorSeed => c !== null);
}

/**
 * Balanced seeding - distribute skill evenly across bracket halves
 */
function seedForBalance(competitors: CompetitorSeed[]): CompetitorSeed[] {
  if (competitors.length <= 2) return competitors;

  // Sort by skill rating
  const sorted = [...competitors].sort(
    (a, b) => (b.skillRating || 0) - (a.skillRating || 0)
  );

  const bracketSize = nextPowerOf2(competitors.length);
  const result: (CompetitorSeed | null)[] = new Array(bracketSize).fill(null);

  // Alternate placing in left and right halves to balance skill
  let leftSum = 0;
  let rightSum = 0;
  const midpoint = Math.floor(bracketSize / 2);

  const leftPositions = [0, 3, 1, 2].filter(p => p < bracketSize);  // Left half positions
  const rightPositions = [7, 4, 6, 5].filter(p => p < bracketSize); // Right half positions
  let leftIdx = 0;
  let rightIdx = 0;

  for (const competitor of sorted) {
    const skill = competitor.skillRating || 0;

    // Place in the half with lower total skill
    if (leftSum <= rightSum && leftIdx < leftPositions.length) {
      result[leftPositions[leftIdx]] = competitor;
      leftSum += skill;
      leftIdx++;
    } else if (rightIdx < rightPositions.length) {
      result[rightPositions[rightIdx]] = competitor;
      rightSum += skill;
      rightIdx++;
    } else if (leftIdx < leftPositions.length) {
      result[leftPositions[leftIdx]] = competitor;
      leftSum += skill;
      leftIdx++;
    }
  }

  return result.filter((c): c is CompetitorSeed => c !== null);
}

/**
 * Fairness-optimized seeding using simulated annealing
 * Maximizes first-round matchup quality while maintaining constraints
 */
function seedForFairness(
  competitors: CompetitorSeed[],
  config?: Partial<SeedingConfig>
): CompetitorSeed[] {
  if (competitors.length <= 2) return competitors;

  // Start with skill-based seeding as base
  let current = seedBySkill(competitors);
  let currentScore = calculateSeedingScore(current, config);

  // Simulated annealing parameters
  const maxIterations = 100;
  let temperature = 1.0;
  const coolingRate = 0.95;

  for (let i = 0; i < maxIterations; i++) {
    // Generate neighbor by swapping two random positions
    const neighbor = [...current];
    const pos1 = Math.floor(Math.random() * neighbor.length);
    let pos2 = Math.floor(Math.random() * neighbor.length);
    while (pos2 === pos1) {
      pos2 = Math.floor(Math.random() * neighbor.length);
    }
    [neighbor[pos1], neighbor[pos2]] = [neighbor[pos2], neighbor[pos1]];

    const neighborScore = calculateSeedingScore(neighbor, config);
    const delta = neighborScore - currentScore;

    // Accept better solutions, or worse ones with probability based on temperature
    if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
      current = neighbor;
      currentScore = neighborScore;
    }

    temperature *= coolingRate;
  }

  return current;
}

/**
 * Calculate seeding quality score for optimization
 */
function calculateSeedingScore(
  seeding: CompetitorSeed[],
  config?: Partial<SeedingConfig>
): number {
  let score = 0;
  const skillWeight = config?.skillBalanceWeight ?? 0.5;

  // Score first-round matchups (positions 0-7, 1-6, 2-5, 3-4 for 8-person)
  const firstRoundPairs = getFirstRoundPairs(seeding.length);

  for (const [pos1, pos2] of firstRoundPairs) {
    if (pos1 >= seeding.length || pos2 >= seeding.length) continue;

    const comp1 = seeding[pos1];
    const comp2 = seeding[pos2];
    if (!comp1 || !comp2) continue;

    // Skill match (closer ratings = better)
    const skillDiff = Math.abs((comp1.skillRating || 0) - (comp2.skillRating || 0));
    score += (400 - Math.min(skillDiff, 400)) / 4 * skillWeight;

    // School diversity (different schools = better)
    if (comp1.school !== comp2.school) {
      score += 25;
    }

    // Region diversity (if enabled)
    if (config?.regionDiversity && comp1.region !== comp2.region) {
      score += 10;
    }

    // Avoid recent matchups
    if (config?.avoidRecentMatchups) {
      const recentOpps1 = comp1.recentOpponents || [];
      const recentOpps2 = comp2.recentOpponents || [];
      if (recentOpps1.includes(comp2.competitorId || '') ||
          recentOpps2.includes(comp1.competitorId || '')) {
        score -= 50; // Penalty for recent rematch
      }
    }
  }

  // Balance score - skill distribution across halves
  const midpoint = Math.floor(seeding.length / 2);
  const leftSkill = seeding.slice(0, midpoint).reduce((sum, c) => sum + (c?.skillRating || 0), 0);
  const rightSkill = seeding.slice(midpoint).reduce((sum, c) => sum + (c?.skillRating || 0), 0);
  const totalSkill = leftSkill + rightSkill;
  if (totalSkill > 0) {
    const balance = 1 - Math.abs(leftSkill - rightSkill) / totalSkill;
    score += balance * 50 * (1 - skillWeight);
  }

  return score;
}

/**
 * Get first round matchup position pairs based on bracket size
 */
function getFirstRoundPairs(size: number): [number, number][] {
  if (size <= 2) return [[0, 1]];
  if (size <= 4) return [[0, 3], [1, 2]];
  const pairs: [number, number][] = [];
  const halfSize = Math.floor(size / 2);
  for (let i = 0; i < halfSize; i++) {
    pairs.push([i, size - 1 - i]);
  }
  return pairs;
}

function distributeBySchool(competitors: CompetitorSeed[]): CompetitorSeed[] {
  if (competitors.length <= 2) return competitors;

  // Group by school
  const schools = new Map<string, CompetitorSeed[]>();
  for (const c of competitors) {
    const school = c.school || 'Unknown';
    if (!schools.has(school)) {
      schools.set(school, []);
    }
    schools.get(school)!.push(c);
  }

  // Sort schools by size (largest first)
  const sortedSchools = Array.from(schools.entries()).sort((a, b) => b[1].length - a[1].length);

  // Distribute into bracket positions
  const result: (CompetitorSeed | null)[] = new Array(competitors.length).fill(null);

  // Standard 8-person seeding positions that avoid same-school first round:
  // Position pairs for first round: (0,7), (1,6), (2,5), (3,4)
  // We want to place same-school competitors in non-adjacent positions
  const positions = [0, 4, 2, 6, 1, 5, 3, 7]; // Spread positions

  let posIdx = 0;
  for (const [_, schoolCompetitors] of sortedSchools) {
    for (const competitor of schoolCompetitors) {
      while (posIdx < positions.length && positions[posIdx] >= competitors.length) {
        posIdx++;
      }
      if (posIdx < positions.length) {
        const targetPos = positions[posIdx] < competitors.length ? positions[posIdx] : posIdx;
        // Find next available position
        let pos = targetPos;
        while (result[pos] !== null && pos < result.length) {
          pos++;
        }
        if (pos >= result.length) {
          pos = 0;
          while (result[pos] !== null) {
            pos++;
          }
        }
        result[pos] = competitor;
        posIdx++;
      }
    }
  }

  return result.filter((c): c is CompetitorSeed => c !== null);
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function nextPowerOf2(n: number): number {
  if (n <= 1) return 2;
  let power = 2;
  while (power < n && power < 64) {
    power *= 2;
  }
  return power;
}

function padWithByes(competitors: CompetitorSeed[], targetSize: number): (CompetitorSeed | null)[] {
  const result: (CompetitorSeed | null)[] = [...competitors];
  while (result.length < targetSize) {
    result.push(null);
  }
  return result;
}

function generateSmallBracket(competitors: (CompetitorSeed | null)[]): BracketStructure {
  const count = competitors.filter((c) => c !== null).length;

  if (count <= 2) {
    return {
      winners: [
        {
          matchNumber: 1,
          round: 1,
          competitor1Id: competitors[0]?.registrationId || null,
          competitor2Id: competitors[1]?.registrationId || null,
        },
      ],
      losers: [],
      finals: [],
      competitorCount: count,
    };
  }

  // 3-4 person bracket
  const winners: MatchData[] = [
    // Round 1 - Semifinals
    {
      matchNumber: 1,
      round: 1,
      competitor1Id: competitors[0]?.registrationId || null,
      competitor2Id: competitors[3]?.registrationId || null,
      nextWinnerMatch: 3,
      nextLoserMatch: 4,
    },
    {
      matchNumber: 2,
      round: 1,
      competitor1Id: competitors[1]?.registrationId || null,
      competitor2Id: competitors[2]?.registrationId || null,
      nextWinnerMatch: 3,
      nextLoserMatch: 4,
    },
    // Round 2 - Winners Final
    {
      matchNumber: 3,
      round: 2,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 6,
      nextLoserMatch: 5,
    },
  ];

  const losers: MatchData[] = [
    // Losers Round 1
    {
      matchNumber: 4,
      round: 1,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 5,
    },
    // Losers Final
    {
      matchNumber: 5,
      round: 2,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 6,
    },
  ];

  const finals: MatchData[] = [
    // Grand Finals
    {
      matchNumber: 6,
      round: 3,
      competitor1Id: null,
      competitor2Id: null,
    },
  ];

  return { winners, losers, finals, competitorCount: count };
}

function generateDoubleEliminationBracket(competitors: (CompetitorSeed | null)[]): BracketStructure {
  const bracketSize = competitors.length; // already a power of 2
  const count = competitors.filter((c) => c !== null).length;

  let matchNumber = 1;
  const winners: MatchData[] = [];
  const losers: MatchData[] = [];

  // --- Winners bracket ---
  // Number of winners rounds = log2(bracketSize)
  const winnersRounds = Math.log2(bracketSize);
  // Build round-by-round, track match numbers per round for linking
  const winnersRoundMatches: number[][] = [];

  // Round 1: seed competitors
  const round1Matches = bracketSize / 2;
  const round1MatchNumbers: number[] = [];
  for (let i = 0; i < round1Matches; i++) {
    const m: MatchData = {
      matchNumber,
      round: 1,
      competitor1Id: competitors[i]?.registrationId || null,
      competitor2Id: competitors[bracketSize - 1 - i]?.registrationId || null,
    };
    round1MatchNumbers.push(matchNumber);
    winners.push(m);
    matchNumber++;
  }
  winnersRoundMatches.push(round1MatchNumbers);

  // Subsequent winners rounds
  for (let round = 2; round <= winnersRounds; round++) {
    const prevMatches = winnersRoundMatches[round - 2];
    const thisRoundCount = prevMatches.length / 2;
    const thisRoundMatchNumbers: number[] = [];

    for (let i = 0; i < thisRoundCount; i++) {
      const m: MatchData = {
        matchNumber,
        round,
        competitor1Id: null,
        competitor2Id: null,
      };
      thisRoundMatchNumbers.push(matchNumber);
      winners.push(m);

      // Link previous round matches to this one
      const prev1 = prevMatches[i * 2];
      const prev2 = prevMatches[i * 2 + 1];
      const w1 = winners.find(w => w.matchNumber === prev1)!;
      const w2 = winners.find(w => w.matchNumber === prev2)!;
      w1.nextWinnerMatch = matchNumber;
      w2.nextWinnerMatch = matchNumber;

      matchNumber++;
    }
    winnersRoundMatches.push(thisRoundMatchNumbers);
  }

  // --- Losers bracket ---
  // Double elimination losers bracket structure:
  // For each winners round R (1..winnersRounds), losers drop down.
  // Losers bracket has (winnersRounds - 1) * 2 rounds:
  //   Odd losers rounds: losers from winners play each other (or feed from previous losers round)
  //   Even losers rounds: losers from winners drop-down play losers bracket survivors
  const losersRoundMatches: number[][] = [];

  // First losers round: losers from winners round 1 paired up
  {
    const wr1 = winnersRoundMatches[0]; // winners round 1 match numbers
    const numMatches = wr1.length / 2;
    const thisRoundMatchNumbers: number[] = [];
    for (let i = 0; i < numMatches; i++) {
      const m: MatchData = {
        matchNumber,
        round: 1,
        competitor1Id: null,
        competitor2Id: null,
      };
      thisRoundMatchNumbers.push(matchNumber);

      // Link losers from winners round 1
      const w1 = winners.find(w => w.matchNumber === wr1[i * 2])!;
      const w2 = winners.find(w => w.matchNumber === wr1[i * 2 + 1])!;
      w1.nextLoserMatch = matchNumber;
      w2.nextLoserMatch = matchNumber;

      losers.push(m);
      matchNumber++;
    }
    losersRoundMatches.push(thisRoundMatchNumbers);
  }

  // Remaining losers rounds
  for (let wr = 2; wr <= winnersRounds; wr++) {
    // Even losers round: previous losers survivors vs nothing yet (just consolidate)
    const prevLosersMatches = losersRoundMatches[losersRoundMatches.length - 1];
    const wrMatches = winnersRoundMatches[wr - 1];
    const numDropDownMatches = wrMatches.length;

    if (prevLosersMatches.length > numDropDownMatches) {
      // Consolidation round: pair up previous losers survivors
      const numMatches = prevLosersMatches.length / 2;
      const thisRoundMatchNumbers: number[] = [];
      for (let i = 0; i < numMatches; i++) {
        const m: MatchData = {
          matchNumber,
          round: losersRoundMatches.length + 1,
          competitor1Id: null,
          competitor2Id: null,
        };
        thisRoundMatchNumbers.push(matchNumber);

        // Link previous losers round
        const l1 = losers.find(l => l.matchNumber === prevLosersMatches[i * 2])!;
        const l2 = losers.find(l => l.matchNumber === prevLosersMatches[i * 2 + 1])!;
        l1.nextWinnerMatch = matchNumber;
        l2.nextWinnerMatch = matchNumber;

        losers.push(m);
        matchNumber++;
      }
      losersRoundMatches.push(thisRoundMatchNumbers);
    }

    // Drop-down round: losers from winners round wr play losers bracket survivors
    // wrMatches and numDropDownMatches already declared above
    const currentLosersMatches = losersRoundMatches[losersRoundMatches.length - 1];

    if (numDropDownMatches > 0 && currentLosersMatches.length === numDropDownMatches) {
      const thisRoundMatchNumbers: number[] = [];
      for (let i = 0; i < numDropDownMatches; i++) {
        const m: MatchData = {
          matchNumber,
          round: losersRoundMatches.length + 1,
          competitor1Id: null,
          competitor2Id: null,
        };
        thisRoundMatchNumbers.push(matchNumber);

        // Link winners loser to this match
        const wMatch = winners.find(w => w.matchNumber === wrMatches[i])!;
        wMatch.nextLoserMatch = matchNumber;

        // Link losers bracket survivor to this match
        const lMatch = losers.find(l => l.matchNumber === currentLosersMatches[i])!;
        lMatch.nextWinnerMatch = matchNumber;

        losers.push(m);
        matchNumber++;
      }
      losersRoundMatches.push(thisRoundMatchNumbers);
    } else if (numDropDownMatches > 0) {
      // For the final winners round, there's one loser dropping to losers final
      const lastLosersRound = losersRoundMatches[losersRoundMatches.length - 1];
      if (lastLosersRound.length === 1) {
        const thisRoundMatchNumbers: number[] = [];
        const m: MatchData = {
          matchNumber,
          round: losersRoundMatches.length + 1,
          competitor1Id: null,
          competitor2Id: null,
        };
        thisRoundMatchNumbers.push(matchNumber);

        // Link winners final loser
        const wMatch = winners.find(w => w.matchNumber === wrMatches[0])!;
        wMatch.nextLoserMatch = matchNumber;

        // Link losers bracket survivor
        const lMatch = losers.find(l => l.matchNumber === lastLosersRound[0])!;
        lMatch.nextWinnerMatch = matchNumber;

        losers.push(m);
        matchNumber++;
        losersRoundMatches.push(thisRoundMatchNumbers);
      }
    }
  }

  // Ensure losers bracket ends with a single match (losers final)
  let lastLosersRound = losersRoundMatches[losersRoundMatches.length - 1];
  while (lastLosersRound.length > 1) {
    const numMatches = lastLosersRound.length / 2;
    const thisRoundMatchNumbers: number[] = [];
    for (let i = 0; i < numMatches; i++) {
      const m: MatchData = {
        matchNumber,
        round: losersRoundMatches.length + 1,
        competitor1Id: null,
        competitor2Id: null,
      };
      thisRoundMatchNumbers.push(matchNumber);

      const l1 = losers.find(l => l.matchNumber === lastLosersRound[i * 2])!;
      const l2 = losers.find(l => l.matchNumber === lastLosersRound[i * 2 + 1])!;
      l1.nextWinnerMatch = matchNumber;
      l2.nextWinnerMatch = matchNumber;

      losers.push(m);
      matchNumber++;
    }
    losersRoundMatches.push(thisRoundMatchNumbers);
    lastLosersRound = thisRoundMatchNumbers;
  }

  // --- Grand finals ---
  const winnersChampMatch = winnersRoundMatches[winnersRoundMatches.length - 1][0];
  const losersChampMatch = losersRoundMatches[losersRoundMatches.length - 1][0];

  // Link winners champion and losers champion to grand finals
  const winnersChamp = winners.find(w => w.matchNumber === winnersChampMatch)!;
  const losersChamp = losers.find(l => l.matchNumber === losersChampMatch)!;

  const grandFinalsNumber = matchNumber;
  winnersChamp.nextWinnerMatch = grandFinalsNumber;
  losersChamp.nextWinnerMatch = grandFinalsNumber;

  const finals: MatchData[] = [
    {
      matchNumber: grandFinalsNumber,
      round: winnersRounds + 1,
      competitor1Id: null,
      competitor2Id: null,
    },
    // Reset match - only if losers bracket champion wins the grand final
    {
      matchNumber: grandFinalsNumber + 1,
      round: winnersRounds + 2,
      competitor1Id: null,
      competitor2Id: null,
    },
  ];

  return { winners, losers, finals, competitorCount: count };
}

/**
 * Single-elimination bracket: no losers bracket, one grand final.
 * Same seeding/padding logic as the double-elim generator; downstream
 * code treats the single final as a 1-match finals array.
 */
function generateSingleEliminationBracket(padded: (CompetitorSeed | null)[]): BracketStructure {
  const count = padded.length;
  const rounds = Math.log2(count);
  const winners: MatchData[] = [];
  const roundMatches: number[][] = [];
  let matchNumber = 1;

  // Round 1: pair seeded competitors (with byes for padded slots).
  const firstRoundMatchNumbers: number[] = [];
  for (let i = 0; i < count; i += 2) {
    const m: MatchData = {
      matchNumber,
      round: 1,
      competitor1Id: padded[i]?.registrationId || null,
      competitor2Id: padded[i + 1]?.registrationId || null,
    };
    firstRoundMatchNumbers.push(matchNumber);
    winners.push(m);
    matchNumber++;
  }
  roundMatches.push(firstRoundMatchNumbers);

  // Rounds 2..N: link to winners of previous round.
  for (let round = 2; round <= rounds; round++) {
    const prevRound = roundMatches[round - 2];
    const thisRoundMatchNumbers: number[] = [];
    for (let i = 0; i < prevRound.length; i += 2) {
      const m: MatchData = {
        matchNumber,
        round,
        competitor1Id: null,
        competitor2Id: null,
      };
      thisRoundMatchNumbers.push(matchNumber);
      const m1 = winners.find(w => w.matchNumber === prevRound[i])!;
      const m2 = winners.find(w => w.matchNumber === prevRound[i + 1])!;
      m1.nextWinnerMatch = matchNumber;
      m2.nextWinnerMatch = matchNumber;
      winners.push(m);
      matchNumber++;
    }
    roundMatches.push(thisRoundMatchNumbers);
  }

  // Promote the last winners match into `finals` so the existing
  // match-advancement / PDF / display code paths handle it the same
  // way they handle the double-elim grand finals.
  const lastWinnerMatch = winners[winners.length - 1];
  lastWinnerMatch.nextWinnerMatch = undefined;
  const finals: MatchData[] = [lastWinnerMatch];
  winners.pop();

  return { winners, losers: [], finals, competitorCount: count };
}

export function generateSingleElimination(
  competitors: CompetitorSeed[],
  strategy: SeedingStrategy = 'school_spread',
  config?: Partial<SeedingConfig>
): BracketStructure {
  const count = competitors.length;
  if (count === 0) {
    return { winners: [], losers: [], finals: [], competitorCount: 0 };
  }
  if (count === 1) {
    return {
      winners: [],
      losers: [],
      finals: [{
        matchNumber: 1,
        round: 1,
        competitor1Id: competitors[0].registrationId,
        competitor2Id: null,
      }],
      competitorCount: 1,
    };
  }
  const seeded = applySeedingStrategy(competitors, strategy, config);
  const bracketSize = nextPowerOf2(count);
  const padded = padWithByes(seeded, bracketSize);
  const seedingInfo = calculateSeedingMetrics(seeded, strategy);
  const bracket = generateSingleEliminationBracket(padded);
  bracket.seedingInfo = seedingInfo;
  return bracket;
}

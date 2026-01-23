// 8-person double elimination bracket generator

export interface CompetitorSeed {
  registrationId: string;
  name: string;
  school: string;
  seedPosition?: number | null;
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
}

type SeedingStrategy = 'random' | 'school_spread' | 'manual';

export function generateBracket(
  competitors: CompetitorSeed[],
  strategy: SeedingStrategy = 'school_spread'
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
  const seeded = applySeedingStrategy(competitors, strategy);

  // Pad to power of 2 (max 8 for standard bracket)
  const bracketSize = Math.min(8, nextPowerOf2(count));
  const padded = padWithByes(seeded, bracketSize);

  // Generate bracket structure
  if (bracketSize <= 4) {
    return generateSmallBracket(padded);
  }

  return generate8PersonBracket(padded);
}

function applySeedingStrategy(
  competitors: CompetitorSeed[],
  strategy: SeedingStrategy
): CompetitorSeed[] {
  switch (strategy) {
    case 'manual':
      // Use existing seed positions
      return [...competitors].sort((a, b) => (a.seedPosition || 99) - (b.seedPosition || 99));

    case 'school_spread':
      // Distribute same-school competitors to minimize first-round matchups
      return distributeBySchool(competitors);

    case 'random':
    default:
      return shuffle(competitors);
  }
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
  if (n <= 2) return 2;
  if (n <= 4) return 4;
  return 8;
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

function generate8PersonBracket(competitors: (CompetitorSeed | null)[]): BracketStructure {
  const count = competitors.filter((c) => c !== null).length;

  // Standard 8-person double elimination bracket
  // Winners bracket: 7 matches (4 + 2 + 1)
  // Losers bracket: 6 matches
  // Grand finals: 1-2 matches

  const winners: MatchData[] = [
    // Round 1 - Quarterfinals (matches 1-4)
    {
      matchNumber: 1,
      round: 1,
      competitor1Id: competitors[0]?.registrationId || null,
      competitor2Id: competitors[7]?.registrationId || null,
      nextWinnerMatch: 5,
      nextLoserMatch: 8,
    },
    {
      matchNumber: 2,
      round: 1,
      competitor1Id: competitors[3]?.registrationId || null,
      competitor2Id: competitors[4]?.registrationId || null,
      nextWinnerMatch: 5,
      nextLoserMatch: 8,
    },
    {
      matchNumber: 3,
      round: 1,
      competitor1Id: competitors[1]?.registrationId || null,
      competitor2Id: competitors[6]?.registrationId || null,
      nextWinnerMatch: 6,
      nextLoserMatch: 9,
    },
    {
      matchNumber: 4,
      round: 1,
      competitor1Id: competitors[2]?.registrationId || null,
      competitor2Id: competitors[5]?.registrationId || null,
      nextWinnerMatch: 6,
      nextLoserMatch: 9,
    },
    // Round 2 - Semifinals (matches 5-6)
    {
      matchNumber: 5,
      round: 2,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 7,
      nextLoserMatch: 11,
    },
    {
      matchNumber: 6,
      round: 2,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 7,
      nextLoserMatch: 12,
    },
    // Round 3 - Winners Final (match 7)
    {
      matchNumber: 7,
      round: 3,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 14,
      nextLoserMatch: 13,
    },
  ];

  const losers: MatchData[] = [
    // Losers Round 1 (matches 8-9)
    {
      matchNumber: 8,
      round: 1,
      competitor1Id: null, // Loser of match 1
      competitor2Id: null, // Loser of match 2
      nextWinnerMatch: 10,
    },
    {
      matchNumber: 9,
      round: 1,
      competitor1Id: null, // Loser of match 3
      competitor2Id: null, // Loser of match 4
      nextWinnerMatch: 10,
    },
    // Losers Round 2 (match 10)
    {
      matchNumber: 10,
      round: 2,
      competitor1Id: null,
      competitor2Id: null,
      nextWinnerMatch: 11,
    },
    // Losers Round 3 (matches 11-12)
    {
      matchNumber: 11,
      round: 3,
      competitor1Id: null, // Winner of match 10
      competitor2Id: null, // Loser of match 5
      nextWinnerMatch: 12,
    },
    {
      matchNumber: 12,
      round: 3,
      competitor1Id: null,
      competitor2Id: null, // Loser of match 6
      nextWinnerMatch: 13,
    },
    // Losers Final (match 13)
    {
      matchNumber: 13,
      round: 4,
      competitor1Id: null,
      competitor2Id: null, // Loser of match 7
      nextWinnerMatch: 14,
    },
  ];

  const finals: MatchData[] = [
    // Grand Finals (match 14)
    {
      matchNumber: 14,
      round: 5,
      competitor1Id: null, // Winner of match 7 (winners bracket champion)
      competitor2Id: null, // Winner of match 13 (losers bracket champion)
    },
    // Reset match (match 15) - only if losers bracket champion wins match 14
    {
      matchNumber: 15,
      round: 6,
      competitor1Id: null,
      competitor2Id: null,
    },
  ];

  return { winners, losers, finals, competitorCount: count };
}

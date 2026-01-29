// 8-person double elimination bracket generator with advanced seeding
export function generateBracket(competitors, strategy = 'school_spread', config) {
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
    // Pad to power of 2 (max 8 for standard bracket)
    const bracketSize = Math.min(8, nextPowerOf2(count));
    const padded = padWithByes(seeded, bracketSize);
    // Calculate seeding quality metrics
    const seedingInfo = calculateSeedingMetrics(seeded, strategy);
    // Generate bracket structure
    let bracket;
    if (bracketSize <= 4) {
        bracket = generateSmallBracket(padded);
    }
    else {
        bracket = generate8PersonBracket(padded);
    }
    bracket.seedingInfo = seedingInfo;
    return bracket;
}
/**
 * Calculate metrics about the seeding quality
 */
function calculateSeedingMetrics(seeded, strategy) {
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
function applySeedingStrategy(competitors, strategy, config) {
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
function seedBySkill(competitors) {
    if (competitors.length <= 2)
        return competitors;
    // Sort by skill rating (highest first)
    const sorted = [...competitors].sort((a, b) => (b.skillRating || 0) - (a.skillRating || 0));
    // Standard 8-person seeding positions:
    // Seed 1 at position 0, Seed 2 at position 7 (opposite side)
    // Seeds 3-4 at positions 3,4 (quarter-final opponents for seeds 1,2)
    // Seeds 5-8 fill remaining positions
    const seedOrder = [0, 7, 3, 4, 1, 6, 2, 5];
    const result = new Array(Math.min(8, competitors.length)).fill(null);
    for (let i = 0; i < sorted.length && i < seedOrder.length; i++) {
        const targetPos = seedOrder[i];
        if (targetPos < result.length) {
            result[targetPos] = { ...sorted[i], seedPosition: i + 1 };
        }
    }
    // Handle competitors beyond standard positions
    if (sorted.length > 8) {
        for (let i = 8; i < sorted.length; i++) {
            result.push({ ...sorted[i], seedPosition: i + 1 });
        }
    }
    return result.filter((c) => c !== null);
}
/**
 * Balanced seeding - distribute skill evenly across bracket halves
 */
function seedForBalance(competitors) {
    if (competitors.length <= 2)
        return competitors;
    // Sort by skill rating
    const sorted = [...competitors].sort((a, b) => (b.skillRating || 0) - (a.skillRating || 0));
    const bracketSize = Math.min(8, competitors.length);
    const result = new Array(bracketSize).fill(null);
    // Alternate placing in left and right halves to balance skill
    let leftSum = 0;
    let rightSum = 0;
    const midpoint = Math.floor(bracketSize / 2);
    const leftPositions = [0, 3, 1, 2].filter(p => p < bracketSize); // Left half positions
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
        }
        else if (rightIdx < rightPositions.length) {
            result[rightPositions[rightIdx]] = competitor;
            rightSum += skill;
            rightIdx++;
        }
        else if (leftIdx < leftPositions.length) {
            result[leftPositions[leftIdx]] = competitor;
            leftSum += skill;
            leftIdx++;
        }
    }
    return result.filter((c) => c !== null);
}
/**
 * Fairness-optimized seeding using simulated annealing
 * Maximizes first-round matchup quality while maintaining constraints
 */
function seedForFairness(competitors, config) {
    if (competitors.length <= 2)
        return competitors;
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
function calculateSeedingScore(seeding, config) {
    let score = 0;
    const skillWeight = config?.skillBalanceWeight ?? 0.5;
    // Score first-round matchups (positions 0-7, 1-6, 2-5, 3-4 for 8-person)
    const firstRoundPairs = getFirstRoundPairs(seeding.length);
    for (const [pos1, pos2] of firstRoundPairs) {
        if (pos1 >= seeding.length || pos2 >= seeding.length)
            continue;
        const comp1 = seeding[pos1];
        const comp2 = seeding[pos2];
        if (!comp1 || !comp2)
            continue;
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
function getFirstRoundPairs(size) {
    if (size <= 2)
        return [[0, 1]];
    if (size <= 4)
        return [[0, 3], [1, 2]];
    return [[0, 7], [1, 6], [2, 5], [3, 4]];
}
function distributeBySchool(competitors) {
    if (competitors.length <= 2)
        return competitors;
    // Group by school
    const schools = new Map();
    for (const c of competitors) {
        const school = c.school || 'Unknown';
        if (!schools.has(school)) {
            schools.set(school, []);
        }
        schools.get(school).push(c);
    }
    // Sort schools by size (largest first)
    const sortedSchools = Array.from(schools.entries()).sort((a, b) => b[1].length - a[1].length);
    // Distribute into bracket positions
    const result = new Array(competitors.length).fill(null);
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
    return result.filter((c) => c !== null);
}
function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function nextPowerOf2(n) {
    if (n <= 2)
        return 2;
    if (n <= 4)
        return 4;
    return 8;
}
function padWithByes(competitors, targetSize) {
    const result = [...competitors];
    while (result.length < targetSize) {
        result.push(null);
    }
    return result;
}
function generateSmallBracket(competitors) {
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
    const winners = [
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
    const losers = [
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
    const finals = [
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
function generate8PersonBracket(competitors) {
    const count = competitors.filter((c) => c !== null).length;
    // Standard 8-person double elimination bracket
    // Winners bracket: 7 matches (4 + 2 + 1)
    // Losers bracket: 6 matches
    // Grand finals: 1-2 matches
    const winners = [
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
    const losers = [
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
    const finals = [
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

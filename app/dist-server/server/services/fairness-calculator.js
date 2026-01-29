import { FAIRNESS_WEIGHTS, PHYSICAL_THRESHOLDS, FAIRNESS_THRESHOLDS, getAgeGroupKey, } from '../../shared/constants/fairness-config.js';
import { getSkillRating, calculateExperienceScore } from './skill-rating.js';
import { shouldAvoidRematch } from './matchup-history.js';
/**
 * Build a competitor profile with all fairness-relevant data
 */
export async function buildCompetitorProfile(prisma, registration, eventType) {
    const [skillRating, experienceScore] = await Promise.all([
        getSkillRating(prisma, registration.competitorId, eventType),
        calculateExperienceScore(prisma, registration.competitorId, eventType),
    ]);
    return {
        registrationId: registration.id,
        competitorId: registration.competitorId,
        firstName: registration.competitor.firstName,
        lastName: registration.competitor.lastName,
        weight: registration.weightAtRegistration || registration.competitor.weightLbs,
        height: registration.heightAtRegistration || registration.competitor.heightInches,
        reach: registration.reachAtRegistration || registration.competitor.reachInches,
        experienceScore,
        skillRating,
        school: registration.competitor.schoolDojang,
        region: registration.competitor.region,
        danRank: registration.competitor.danRank,
        belt: registration.competitor.belt,
        ageAtTournament: registration.ageAtTournament,
    };
}
/**
 * Calculate weight proximity score
 */
function calculateWeightProximity(weight1, weight2, ageGroup) {
    if (weight1 === null || weight2 === null) {
        return 50; // Unknown = neutral score
    }
    const threshold = PHYSICAL_THRESHOLDS.weight[ageGroup] || 20;
    const diff = Math.abs(weight1 - weight2);
    if (diff === 0)
        return 100;
    if (diff >= threshold * 2)
        return 0;
    // Linear scale from threshold
    return Math.max(0, 100 - (diff / threshold) * 50);
}
/**
 * Calculate height proximity score
 */
function calculateHeightProximity(height1, height2, ageGroup) {
    if (height1 === null || height2 === null) {
        return 50; // Unknown = neutral
    }
    const threshold = PHYSICAL_THRESHOLDS.height[ageGroup] || 8;
    const diff = Math.abs(height1 - height2);
    if (diff === 0)
        return 100;
    if (diff >= threshold * 2)
        return 0;
    return Math.max(0, 100 - (diff / threshold) * 50);
}
/**
 * Calculate reach proximity score
 */
function calculateReachProximity(reach1, reach2) {
    if (reach1 === null || reach2 === null) {
        return 50; // Unknown = neutral
    }
    const diff = Math.abs(reach1 - reach2);
    if (diff === 0)
        return 100;
    if (diff >= PHYSICAL_THRESHOLDS.reach.critical * 2)
        return 0;
    return Math.max(0, 100 - (diff / PHYSICAL_THRESHOLDS.reach.significant) * 33);
}
/**
 * Calculate experience match score
 */
function calculateExperienceMatch(exp1, exp2) {
    const diff = Math.abs(exp1 - exp2);
    // Max expected difference is 100 (full experience gap)
    return Math.max(0, 100 - diff);
}
/**
 * Calculate skill match score
 */
function calculateSkillMatch(rating1, rating2) {
    const diff = Math.abs(rating1 - rating2);
    // Normalize: 400 rating diff = very poor match
    if (diff >= 400)
        return 0;
    return Math.max(0, 100 - (diff / 400) * 100);
}
/**
 * Calculate school diversity score
 */
function calculateSchoolDiversity(school1, school2) {
    if (school1 === null || school2 === null) {
        return 75; // Unknown = slightly positive
    }
    // Same school = 0, different = 100
    return school1.toLowerCase().trim() === school2.toLowerCase().trim() ? 0 : 100;
}
/**
 * Get grade from overall score
 */
function getGrade(score) {
    if (score >= FAIRNESS_THRESHOLDS.excellent)
        return 'A';
    if (score >= FAIRNESS_THRESHOLDS.good)
        return 'B';
    if (score >= FAIRNESS_THRESHOLDS.acceptable)
        return 'C';
    if (score >= FAIRNESS_THRESHOLDS.poor)
        return 'D';
    return 'F';
}
/**
 * Calculate matchup fairness between two competitors
 */
export async function calculateMatchFairness(prisma, comp1, comp2, eventType, tournamentId, ageGroup) {
    const weights = FAIRNESS_WEIGHTS[eventType];
    const warnings = [];
    const recommendations = [];
    // Calculate all factors
    const factors = {
        weightProximity: calculateWeightProximity(comp1.weight, comp2.weight, ageGroup),
        heightProximity: calculateHeightProximity(comp1.height, comp2.height, ageGroup),
        reachProximity: calculateReachProximity(comp1.reach, comp2.reach),
        experienceMatch: calculateExperienceMatch(comp1.experienceScore, comp2.experienceScore),
        skillMatch: calculateSkillMatch(comp1.skillRating, comp2.skillRating),
        schoolDiversity: calculateSchoolDiversity(comp1.school, comp2.school),
        noRepeatMatchup: 100, // Default, will update below
    };
    // Check for recent rematches
    const rematchCheck = await shouldAvoidRematch(prisma, comp1.competitorId, comp2.competitorId, tournamentId);
    if (rematchCheck.avoid) {
        factors.noRepeatMatchup = rematchCheck.severity === 'high' ? 0 : 50;
        warnings.push(rematchCheck.reason || 'Recent rematch');
    }
    // Generate warnings based on factors
    if (factors.weightProximity < 40 && eventType === 'sparring') {
        const weightDiff = Math.abs((comp1.weight || 0) - (comp2.weight || 0));
        warnings.push(`Weight difference: ${weightDiff.toFixed(1)} lbs`);
        recommendations.push('Consider different weight class placement');
    }
    if (factors.heightProximity < 40 && eventType === 'sparring') {
        const heightDiff = Math.abs((comp1.height || 0) - (comp2.height || 0));
        warnings.push(`Height difference: ${heightDiff.toFixed(1)} inches`);
    }
    if (factors.reachProximity < 40 && eventType === 'sparring') {
        const reachDiff = Math.abs((comp1.reach || 0) - (comp2.reach || 0));
        warnings.push(`Significant reach advantage: ${reachDiff.toFixed(1)} inches`);
    }
    if (factors.skillMatch < 30) {
        const ratingDiff = Math.abs(comp1.skillRating - comp2.skillRating);
        warnings.push(`Large skill gap: ${Math.round(ratingDiff)} rating points`);
        recommendations.push('Consider seeding adjustment');
    }
    if (factors.experienceMatch < 30) {
        warnings.push('Large experience gap');
    }
    if (factors.schoolDiversity === 0) {
        warnings.push('Same school matchup');
        recommendations.push('Adjust seeding to avoid same-school first round');
    }
    // Calculate weighted overall score
    let overall;
    if (eventType === 'sparring') {
        const sparringWeights = FAIRNESS_WEIGHTS.sparring;
        overall =
            factors.weightProximity * sparringWeights.weight +
                factors.heightProximity * sparringWeights.height +
                factors.reachProximity * sparringWeights.reach +
                factors.experienceMatch * sparringWeights.experience +
                factors.skillMatch * sparringWeights.skill +
                factors.schoolDiversity * sparringWeights.school +
                factors.noRepeatMatchup * sparringWeights.noRematch;
    }
    else {
        const patternsWeights = FAIRNESS_WEIGHTS.patterns;
        overall =
            factors.experienceMatch * patternsWeights.experience +
                factors.skillMatch * patternsWeights.skill +
                factors.schoolDiversity * patternsWeights.school +
                factors.noRepeatMatchup * patternsWeights.noRematch;
    }
    return {
        overall: Math.round(overall),
        factors,
        warnings,
        recommendations,
        grade: getGrade(overall),
    };
}
/**
 * Calculate bracket fairness report
 */
export async function calculateBracketFairness(prisma, divisionId, bracketStructure, // Parsed bracket JSON
eventType, tournamentId, ageGroup) {
    // Get all registrations for this division
    const assignments = await prisma.divisionAssignment.findMany({
        where: { divisionId },
        include: {
            registration: {
                include: { competitor: true },
            },
        },
    });
    // Build profiles for all competitors
    const profiles = new Map();
    for (const a of assignments) {
        const profile = await buildCompetitorProfile(prisma, a.registration, eventType);
        profiles.set(a.registrationId, profile);
    }
    const matchScores = [];
    const warnings = [];
    const recommendations = [];
    // Analyze first-round matches from bracket structure
    const firstRoundMatches = extractFirstRoundMatches(bracketStructure);
    for (const match of firstRoundMatches) {
        if (!match.competitor1Id || !match.competitor2Id)
            continue;
        const profile1 = profiles.get(match.competitor1Id);
        const profile2 = profiles.get(match.competitor2Id);
        if (!profile1 || !profile2)
            continue;
        const fairness = await calculateMatchFairness(prisma, profile1, profile2, eventType, tournamentId, ageGroup);
        matchScores.push({
            round: 1,
            matchNumber: match.matchNumber,
            competitor1: `${profile1.firstName} ${profile1.lastName}`,
            competitor2: `${profile2.firstName} ${profile2.lastName}`,
            fairnessScore: fairness.overall,
            factors: fairness.factors,
            warnings: fairness.warnings,
        });
        if (fairness.grade === 'F') {
            warnings.push(`Critical mismatch in match ${match.matchNumber}: ${profile1.lastName} vs ${profile2.lastName}`);
        }
    }
    // Calculate skill distribution across bracket halves
    const allProfiles = Array.from(profiles.values());
    const sortedByPosition = allProfiles.sort((a, b) => {
        // Sort by seed position if available
        const aPos = assignments.find((x) => x.registrationId === a.registrationId)?.seedPosition || 0;
        const bPos = assignments.find((x) => x.registrationId === b.registrationId)?.seedPosition || 0;
        return aPos - bPos;
    });
    const midpoint = Math.floor(sortedByPosition.length / 2);
    const leftHalf = sortedByPosition.slice(0, midpoint);
    const rightHalf = sortedByPosition.slice(midpoint);
    const leftSkill = leftHalf.reduce((sum, p) => sum + p.skillRating, 0);
    const rightSkill = rightHalf.reduce((sum, p) => sum + p.skillRating, 0);
    const totalSkill = leftSkill + rightSkill;
    const balance = totalSkill > 0
        ? 100 - Math.abs((leftSkill - rightSkill) / totalSkill) * 100
        : 100;
    if (balance < 60) {
        warnings.push('Bracket is unbalanced - strong competitors concentrated on one side');
        recommendations.push('Consider re-seeding to distribute skill more evenly');
    }
    // Calculate overall score
    const avgMatchScore = matchScores.length > 0
        ? matchScores.reduce((sum, m) => sum + m.fairnessScore, 0) / matchScores.length
        : 100;
    const overallScore = Math.round(avgMatchScore * 0.7 + balance * 0.3);
    return {
        overallScore,
        grade: getGrade(overallScore),
        matchScores,
        skillDistribution: {
            leftHalf: Math.round(leftSkill / (leftHalf.length || 1)),
            rightHalf: Math.round(rightSkill / (rightHalf.length || 1)),
            balance: Math.round(balance),
        },
        warnings,
        recommendations,
    };
}
/**
 * Extract first round matches from bracket structure
 */
function extractFirstRoundMatches(structure) {
    const matches = [];
    if (!structure || !structure.winners) {
        return matches;
    }
    // First round is round 0 in winners bracket
    const firstRound = structure.winners[0];
    if (!firstRound)
        return matches;
    firstRound.forEach((match, index) => {
        matches.push({
            matchNumber: index + 1,
            competitor1Id: match?.competitor1?.registrationId,
            competitor2Id: match?.competitor2?.registrationId,
        });
    });
    return matches;
}
/**
 * Quick fairness check for a proposed matchup
 */
export async function quickFairnessCheck(prisma, registrationId1, registrationId2, eventType, tournamentId, ageMin, ageMax) {
    const [reg1, reg2] = await Promise.all([
        prisma.registration.findUnique({
            where: { id: registrationId1 },
            include: { competitor: true },
        }),
        prisma.registration.findUnique({
            where: { id: registrationId2 },
            include: { competitor: true },
        }),
    ]);
    if (!reg1 || !reg2) {
        return { score: 0, grade: 'F', warnings: ['Registration not found'] };
    }
    const [profile1, profile2] = await Promise.all([
        buildCompetitorProfile(prisma, reg1, eventType),
        buildCompetitorProfile(prisma, reg2, eventType),
    ]);
    const ageGroup = getAgeGroupKey(ageMin, ageMax);
    const result = await calculateMatchFairness(prisma, profile1, profile2, eventType, tournamentId, ageGroup);
    return {
        score: result.overall,
        grade: result.grade,
        warnings: result.warnings,
    };
}
/**
 * Get fairness recommendations for a division
 */
export async function getDivisionFairnessRecommendations(prisma, divisionId, eventType, tournamentId) {
    const division = await prisma.division.findUnique({
        where: { id: divisionId },
    });
    if (!division) {
        return { competitorProfiles: [], pairwiseScores: [], averageScore: 0, recommendations: [] };
    }
    const assignments = await prisma.divisionAssignment.findMany({
        where: { divisionId },
        include: {
            registration: { include: { competitor: true } },
        },
    });
    const profiles = [];
    for (const a of assignments) {
        const profile = await buildCompetitorProfile(prisma, a.registration, eventType);
        profiles.push(profile);
    }
    const ageGroup = getAgeGroupKey(division.ageMin, division.ageMax);
    const pairwiseScores = [];
    // Calculate all pairwise fairness scores
    for (let i = 0; i < profiles.length; i++) {
        for (let j = i + 1; j < profiles.length; j++) {
            const result = await calculateMatchFairness(prisma, profiles[i], profiles[j], eventType, tournamentId, ageGroup);
            pairwiseScores.push({
                comp1Id: profiles[i].competitorId,
                comp2Id: profiles[j].competitorId,
                score: result.overall,
                grade: result.grade,
            });
        }
    }
    const averageScore = pairwiseScores.length > 0
        ? pairwiseScores.reduce((sum, p) => sum + p.score, 0) / pairwiseScores.length
        : 100;
    const recommendations = [];
    // Generate recommendations
    const poorMatchups = pairwiseScores.filter((p) => p.grade === 'D' || p.grade === 'F');
    if (poorMatchups.length > 0) {
        recommendations.push(`${poorMatchups.length} potential poor matchups detected - consider seeding adjustments`);
    }
    // Check skill variance
    const skillRatings = profiles.map((p) => p.skillRating);
    const skillVariance = calculateVariance(skillRatings);
    if (skillVariance > 40000) {
        // High variance
        recommendations.push('Wide skill range in division - consider splitting by skill level');
    }
    // Check weight variance for sparring
    if (eventType === 'sparring') {
        const weights = profiles.filter((p) => p.weight !== null).map((p) => p.weight);
        if (weights.length >= 2) {
            const weightVariance = calculateVariance(weights);
            if (weightVariance > 200) {
                // High weight variance
                recommendations.push('Wide weight range - consider reviewing weight class assignments');
            }
        }
    }
    return {
        competitorProfiles: profiles,
        pairwiseScores,
        averageScore: Math.round(averageScore),
        recommendations,
    };
}
/**
 * Calculate variance of a number array
 */
function calculateVariance(values) {
    if (values.length === 0)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
}

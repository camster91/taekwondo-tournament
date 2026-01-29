import { RATING_CONFIG, getKFactor, getInitialSkillEstimate, PLACEMENT_POINTS, TOURNAMENT_RECENCY_WEIGHTS, } from '../../shared/constants/fairness-config.js';
/**
 * Calculate expected win probability using ELO formula
 */
export function expectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}
/**
 * Get or create a competitor's rating for an event type
 */
export async function getOrCreateRating(prisma, competitorId, eventType, competitor) {
    // Try to get existing rating
    let rating = await prisma.competitorRating.findUnique({
        where: {
            competitorId_eventType: { competitorId, eventType },
        },
    });
    if (!rating) {
        // Get competitor info for initial estimate if not provided
        if (!competitor) {
            competitor = await prisma.competitor.findUnique({
                where: { id: competitorId },
            });
        }
        const initialRating = competitor
            ? getInitialSkillEstimate(competitor.belt, competitor.danRank, eventType)
            : RATING_CONFIG.initialRating;
        rating = await prisma.competitorRating.create({
            data: {
                competitorId,
                eventType,
                rating: initialRating,
                peakRating: initialRating,
                matchesPlayed: 0,
            },
        });
    }
    return rating;
}
/**
 * Update ratings after a match result
 */
export async function updateRatingsAfterMatch(prisma, winnerId, loserId, eventType) {
    // Get current ratings
    const [winnerRating, loserRating] = await Promise.all([
        getOrCreateRating(prisma, winnerId, eventType),
        getOrCreateRating(prisma, loserId, eventType),
    ]);
    // Calculate expected outcomes
    const expectedWinner = expectedScore(winnerRating.rating, loserRating.rating);
    const expectedLoser = 1 - expectedWinner;
    // Get K-factors based on experience
    const kWinner = getKFactor(winnerRating.matchesPlayed);
    const kLoser = getKFactor(loserRating.matchesPlayed);
    // Calculate new ratings
    const winnerChange = Math.round(kWinner * (1 - expectedWinner));
    const loserChange = Math.round(kLoser * (0 - expectedLoser));
    const newWinnerRating = winnerRating.rating + winnerChange;
    const newLoserRating = Math.max(100, loserRating.rating + loserChange); // Floor at 100
    // Update database
    await Promise.all([
        prisma.competitorRating.update({
            where: { id: winnerRating.id },
            data: {
                rating: newWinnerRating,
                peakRating: Math.max(winnerRating.peakRating, newWinnerRating),
                matchesPlayed: winnerRating.matchesPlayed + 1,
                lastMatchDate: new Date(),
                lastUpdated: new Date(),
            },
        }),
        prisma.competitorRating.update({
            where: { id: loserRating.id },
            data: {
                rating: newLoserRating,
                matchesPlayed: loserRating.matchesPlayed + 1,
                lastMatchDate: new Date(),
                lastUpdated: new Date(),
            },
        }),
    ]);
    return {
        winner: {
            competitorId: winnerId,
            previousRating: winnerRating.rating,
            newRating: newWinnerRating,
            change: winnerChange,
        },
        loser: {
            competitorId: loserId,
            previousRating: loserRating.rating,
            newRating: newLoserRating,
            change: loserChange,
        },
    };
}
/**
 * Get skill rating for a competitor
 */
export async function getSkillRating(prisma, competitorId, eventType) {
    const rating = await prisma.competitorRating.findUnique({
        where: {
            competitorId_eventType: { competitorId, eventType },
        },
    });
    if (rating) {
        return rating.rating;
    }
    // Estimate from competitor profile
    const competitor = await prisma.competitor.findUnique({
        where: { id: competitorId },
    });
    return competitor
        ? getInitialSkillEstimate(competitor.belt, competitor.danRank, eventType)
        : RATING_CONFIG.initialRating;
}
/**
 * Apply rating decay for inactive competitors
 */
export async function applyRatingDecay(prisma, eventType) {
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setMonth(thresholdDate.getMonth() - RATING_CONFIG.inactivityThreshold);
    const whereClause = {
        lastMatchDate: { lt: thresholdDate },
        rating: { gt: RATING_CONFIG.initialRating - RATING_CONFIG.maxDecay },
    };
    if (eventType) {
        whereClause.eventType = eventType;
    }
    // Get inactive competitors
    const inactiveRatings = await prisma.competitorRating.findMany({
        where: whereClause,
    });
    let updatedCount = 0;
    for (const rating of inactiveRatings) {
        if (!rating.lastMatchDate)
            continue;
        // Calculate months inactive
        const monthsInactive = Math.floor((now.getTime() - rating.lastMatchDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
        // Calculate decay
        const decayMonths = monthsInactive - RATING_CONFIG.inactivityThreshold;
        if (decayMonths <= 0)
            continue;
        const totalDecay = Math.min(decayMonths * RATING_CONFIG.decayPerMonth, RATING_CONFIG.maxDecay);
        const newRating = Math.max(RATING_CONFIG.initialRating - RATING_CONFIG.maxDecay, rating.rating - totalDecay);
        if (newRating !== rating.rating) {
            await prisma.competitorRating.update({
                where: { id: rating.id },
                data: { rating: newRating, lastUpdated: new Date() },
            });
            updatedCount++;
        }
    }
    return updatedCount;
}
/**
 * Calculate experience score for a competitor
 */
export async function calculateExperienceScore(prisma, competitorId, eventType) {
    // Get competitor data
    const competitor = await prisma.competitor.findUnique({
        where: { id: competitorId },
    });
    if (!competitor)
        return 0;
    // Get tournament history
    const history = await prisma.competitorHistory.findMany({
        where: { competitorId, eventType },
        orderBy: { createdAt: 'desc' },
        take: 10, // Last 10 tournaments
    });
    let score = 0;
    const maxScore = 100;
    // Factor 1: Dan rank (for black belts) - 30%
    if (competitor.danRank) {
        score += (competitor.danRank / 6) * 30; // Max 30 points for 6th Dan
    }
    // Factor 2: Belt age (time in current belt) - 20%
    if (competitor.beltPromotionDate) {
        const monthsInBelt = Math.floor((Date.now() - competitor.beltPromotionDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
        score += Math.min(monthsInBelt / 24, 1) * 20; // Max 20 points for 2+ years
    }
    // Factor 3: Tournament count - 25%
    const tournamentCount = history.length;
    score += Math.min(tournamentCount / 10, 1) * 25; // Max 25 points for 10+ tournaments
    // Factor 4: Placement history with recency weighting - 25%
    let placementScore = 0;
    let weightSum = 0;
    history.forEach((h, index) => {
        const recencyWeight = TOURNAMENT_RECENCY_WEIGHTS[Math.min(index, 5)];
        const points = PLACEMENT_POINTS[Math.min(h.placement, 5)] || 0;
        placementScore += (points / 100) * recencyWeight;
        weightSum += recencyWeight;
    });
    if (weightSum > 0) {
        score += (placementScore / weightSum) * 25;
    }
    return Math.min(score, maxScore);
}
/**
 * Batch update ratings for multiple competitors
 */
export async function batchGetRatings(prisma, competitorIds, eventType) {
    const ratings = await prisma.competitorRating.findMany({
        where: {
            competitorId: { in: competitorIds },
            eventType,
        },
    });
    const ratingMap = new Map();
    const foundIds = new Set();
    for (const rating of ratings) {
        ratingMap.set(rating.competitorId, rating.rating);
        foundIds.add(rating.competitorId);
    }
    // For missing ratings, estimate from competitor profiles
    const missingIds = competitorIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        const competitors = await prisma.competitor.findMany({
            where: { id: { in: missingIds } },
        });
        for (const comp of competitors) {
            ratingMap.set(comp.id, getInitialSkillEstimate(comp.belt, comp.danRank, eventType));
        }
    }
    return ratingMap;
}
/**
 * Record tournament placement and update history
 */
export async function recordTournamentResult(prisma, competitorId, tournamentId, divisionId, divisionName, eventType, placement, matchesWon, matchesLost) {
    // Calculate points based on placement
    const points = PLACEMENT_POINTS[Math.min(placement, 5)] || 0;
    await prisma.competitorHistory.create({
        data: {
            competitorId,
            tournamentId,
            divisionId,
            divisionName,
            eventType,
            placement,
            matchesWon,
            matchesLost,
            points,
        },
    });
}
/**
 * Get competitor's full rating profile
 */
export async function getRatingProfile(prisma, competitorId, eventType) {
    const [ratingData, experienceScore, history] = await Promise.all([
        getOrCreateRating(prisma, competitorId, eventType),
        calculateExperienceScore(prisma, competitorId, eventType),
        prisma.competitorHistory.findMany({
            where: { competitorId, eventType },
            orderBy: { createdAt: 'desc' },
            take: 20,
        }),
    ]);
    return {
        rating: ratingData.rating,
        peak: ratingData.peakRating,
        matchesPlayed: ratingData.matchesPlayed,
        experienceScore,
        tournamentHistory: history.map((h) => ({
            tournamentId: h.tournamentId,
            divisionName: h.divisionName,
            placement: h.placement,
            matchesWon: h.matchesWon,
            matchesLost: h.matchesLost,
            date: h.createdAt,
        })),
    };
}

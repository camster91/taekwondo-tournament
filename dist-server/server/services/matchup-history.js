import { REMATCH_CONFIG } from '../../shared/constants/fairness-config.js';
/**
 * Normalize competitor ID pair (always alphabetically ordered)
 */
function normalizeIdPair(id1, id2) {
    return id1 < id2 ? [id1, id2] : [id2, id1];
}
/**
 * Record a completed match in the history
 */
export async function recordMatchResult(prisma, match) {
    const [id1, id2] = normalizeIdPair(match.competitor1Id, match.competitor2Id);
    await prisma.matchupHistory.create({
        data: {
            competitor1Id: id1,
            competitor2Id: id2,
            tournamentId: match.tournamentId,
            divisionId: match.divisionId,
            matchId: match.matchId,
            winnerId: match.winnerId,
            eventType: match.eventType,
            roundNumber: match.roundNumber,
            score: match.score || null,
        },
    });
}
/**
 * Get head-to-head history between two competitors
 */
export async function getHeadToHead(prisma, competitorAId, competitorBId) {
    const [id1, id2] = normalizeIdPair(competitorAId, competitorBId);
    const matches = await prisma.matchupHistory.findMany({
        where: {
            competitor1Id: id1,
            competitor2Id: id2,
        },
        orderBy: { createdAt: 'desc' },
    });
    if (matches.length === 0) {
        return null;
    }
    const id1Wins = matches.filter((m) => m.winnerId === id1).length;
    const id2Wins = matches.filter((m) => m.winnerId === id2).length;
    return {
        competitor1Id: id1,
        competitor2Id: id2,
        totalMatches: matches.length,
        competitor1Wins: competitorAId === id1 ? id1Wins : id2Wins,
        competitor2Wins: competitorAId === id1 ? id2Wins : id1Wins,
        lastMatchDate: matches[0]?.createdAt || null,
        lastTournamentId: matches[0]?.tournamentId || null,
        matchHistory: matches.map((m) => ({
            tournamentId: m.tournamentId,
            divisionId: m.divisionId,
            matchId: m.matchId,
            winnerId: m.winnerId,
            eventType: m.eventType,
            roundNumber: m.roundNumber,
            score: m.score,
            date: m.createdAt,
        })),
    };
}
/**
 * Check if a rematch should be avoided
 */
export async function shouldAvoidRematch(prisma, competitor1Id, competitor2Id, currentTournamentId, config = {
    avoidRecentMatchups: true,
    lookbackTournaments: REMATCH_CONFIG.avoidRecentTournaments,
}) {
    if (!config.avoidRecentMatchups) {
        return { avoid: false, severity: 'low' };
    }
    // Allow rematches in finals if configured
    if (config.isFinal && REMATCH_CONFIG.allowFinalRematch) {
        return { avoid: false, severity: 'low' };
    }
    const history = await getHeadToHead(prisma, competitor1Id, competitor2Id);
    if (!history || history.totalMatches === 0) {
        return { avoid: false, severity: 'low' };
    }
    // Get recent tournaments to check
    const recentTournaments = await prisma.tournament.findMany({
        where: { id: { not: currentTournamentId } },
        orderBy: { date: 'desc' },
        take: config.lookbackTournaments,
        select: { id: true },
    });
    const recentTournamentIds = new Set(recentTournaments.map((t) => t.id));
    // Check if they matched in recent tournaments
    const recentMatches = history.matchHistory.filter((m) => recentTournamentIds.has(m.tournamentId));
    if (recentMatches.length > 0) {
        const tournamentsAgo = recentTournaments.findIndex((t) => t.id === recentMatches[0].tournamentId) + 1;
        return {
            avoid: true,
            reason: `Faced each other ${tournamentsAgo} tournament(s) ago`,
            severity: tournamentsAgo === 1 ? 'high' : 'medium',
        };
    }
    // Check for lopsided records (boring matchups)
    const winDiff = Math.abs(history.competitor1Wins - history.competitor2Wins);
    if (history.totalMatches >= 3 && winDiff >= 3) {
        return {
            avoid: true,
            reason: `Lopsided history: ${Math.max(history.competitor1Wins, history.competitor2Wins)}-${Math.min(history.competitor1Wins, history.competitor2Wins)}`,
            severity: 'medium',
        };
    }
    return { avoid: false, severity: 'low' };
}
/**
 * Get matchup matrix for a set of competitors
 */
export async function getMatchupMatrix(prisma, competitorIds) {
    const matrix = new Map();
    if (competitorIds.length < 2) {
        return matrix;
    }
    // Get all matchups involving these competitors
    const matchups = await prisma.matchupHistory.findMany({
        where: {
            OR: [
                { competitor1Id: { in: competitorIds }, competitor2Id: { in: competitorIds } },
            ],
        },
        orderBy: { createdAt: 'desc' },
    });
    // Group by pair
    const pairGroups = new Map();
    for (const match of matchups) {
        const key = `${match.competitor1Id}-${match.competitor2Id}`;
        if (!pairGroups.has(key)) {
            pairGroups.set(key, []);
        }
        pairGroups.get(key).push(match);
    }
    // Convert to HeadToHead format
    for (const [key, matches] of pairGroups) {
        const [id1, id2] = key.split('-');
        const id1Wins = matches.filter((m) => m.winnerId === id1).length;
        const id2Wins = matches.filter((m) => m.winnerId === id2).length;
        matrix.set(key, {
            competitor1Id: id1,
            competitor2Id: id2,
            totalMatches: matches.length,
            competitor1Wins: id1Wins,
            competitor2Wins: id2Wins,
            lastMatchDate: matches[0]?.createdAt || null,
            lastTournamentId: matches[0]?.tournamentId || null,
            matchHistory: matches.map((m) => ({
                tournamentId: m.tournamentId,
                divisionId: m.divisionId,
                matchId: m.matchId,
                winnerId: m.winnerId,
                eventType: m.eventType,
                roundNumber: m.roundNumber,
                score: m.score,
                date: m.createdAt,
            })),
        });
    }
    return matrix;
}
/**
 * Get recent opponents for a competitor
 */
export async function getRecentOpponents(prisma, competitorId, limit = 10) {
    const asCompetitor1 = await prisma.matchupHistory.findMany({
        where: { competitor1Id: competitorId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { competitor2Id: true },
    });
    const asCompetitor2 = await prisma.matchupHistory.findMany({
        where: { competitor2Id: competitorId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { competitor1Id: true },
    });
    // Combine and dedupe
    const opponents = new Set();
    for (const m of asCompetitor1) {
        opponents.add(m.competitor2Id);
    }
    for (const m of asCompetitor2) {
        opponents.add(m.competitor1Id);
    }
    return Array.from(opponents);
}
/**
 * Get rematch avoidance recommendations for a division
 */
export async function getRematchRecommendations(prisma, competitorIds, tournamentId) {
    const recommendations = [];
    // Check all possible pairs
    for (let i = 0; i < competitorIds.length; i++) {
        for (let j = i + 1; j < competitorIds.length; j++) {
            const result = await shouldAvoidRematch(prisma, competitorIds[i], competitorIds[j], tournamentId);
            if (result.avoid) {
                recommendations.push({
                    competitor1Id: competitorIds[i],
                    competitor2Id: competitorIds[j],
                    ...result,
                });
            }
        }
    }
    return recommendations;
}
/**
 * Get competitor's win rate against specific opponents
 */
export async function getWinRateAgainst(prisma, competitorId, opponentIds) {
    const results = new Map();
    for (const opponentId of opponentIds) {
        const history = await getHeadToHead(prisma, competitorId, opponentId);
        if (history) {
            const wins = competitorId === history.competitor1Id
                ? history.competitor1Wins
                : history.competitor2Wins;
            const losses = history.totalMatches - wins;
            results.set(opponentId, {
                wins,
                losses,
                rate: history.totalMatches > 0 ? wins / history.totalMatches : 0.5,
            });
        }
        else {
            results.set(opponentId, { wins: 0, losses: 0, rate: 0.5 });
        }
    }
    return results;
}

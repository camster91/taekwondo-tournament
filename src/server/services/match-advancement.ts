// Match advancement logic for double elimination brackets
import { PrismaClient, Match } from '@prisma/client';
import { BracketStructure, MatchData } from './bracket-generator.js';

export interface AdvancementResult {
  advanced: boolean;
  nextMatchId?: string;
  loserNextMatchId?: string;
  message: string;
}

/**
 * Advances the winner (and loser in double elimination) to the next appropriate match
 */
export async function advanceWinner(
  prisma: PrismaClient,
  match: Match & { bracketId: string }
): Promise<AdvancementResult> {
  if (!match.winnerId) {
    return { advanced: false, message: 'No winner set for this match' };
  }

  // Get bracket structure
  const bracket = await prisma.bracket.findUnique({
    where: { id: match.bracketId },
    include: {
      matches: true,
    },
  });

  if (!bracket) {
    return { advanced: false, message: 'Bracket not found' };
  }

  const structure: BracketStructure = JSON.parse(bracket.structure);

  // Find the match data in the structure
  const allMatches = [
    ...structure.winners.map(m => ({ ...m, bracketType: 'winners' as const })),
    ...structure.losers.map(m => ({ ...m, bracketType: 'losers' as const })),
    ...structure.finals.map(m => ({ ...m, bracketType: 'finals' as const })),
  ];

  const matchData = allMatches.find(
    m => m.matchNumber === match.matchNumber && m.bracketType === match.bracketType
  );

  if (!matchData) {
    return { advanced: false, message: 'Match structure not found' };
  }

  const results: string[] = [];

  // Advance winner to next match
  if (matchData.nextWinnerMatch) {
    const nextWinnerDb = bracket.matches.find(
      m => m.matchNumber === matchData.nextWinnerMatch
    );

    if (nextWinnerDb) {
      await advanceToMatch(prisma, nextWinnerDb.id, match.winnerId, match.matchNumber);
      results.push(`Winner advanced to match ${matchData.nextWinnerMatch}`);
    }
  }

  // Advance loser to losers bracket (only in winners bracket and early losers rounds)
  if (matchData.nextLoserMatch && match.bracketType === 'winners') {
    const loserId = match.competitor1Id === match.winnerId
      ? match.competitor2Id
      : match.competitor1Id;

    if (loserId) {
      const nextLoserDb = bracket.matches.find(
        m => m.matchNumber === matchData.nextLoserMatch
      );

      if (nextLoserDb) {
        await advanceToMatch(prisma, nextLoserDb.id, loserId, match.matchNumber);
        results.push(`Loser advanced to losers bracket match ${matchData.nextLoserMatch}`);
      }
    }
  }

  // Check if grand finals reset is needed
  if (match.bracketType === 'finals' && match.matchNumber === 14) {
    // Grand finals - check if losers bracket champion won
    // The winner from losers bracket is competitor2 in grand finals
    const needsReset = match.winnerId === match.competitor2Id;

    if (needsReset) {
      // Activate reset match (match 15)
      const resetMatch = bracket.matches.find(m => m.matchNumber === 15);
      if (resetMatch) {
        await prisma.match.update({
          where: { id: resetMatch.id },
          data: {
            competitor1Id: match.competitor1Id, // Original winners bracket champion
            competitor2Id: match.competitor2Id, // Losers bracket champion (who just won)
            status: 'ready',
          },
        });
        results.push('Reset match activated - losers bracket champion won grand finals');
      }
    }
  }

  // Update ready status for affected matches
  await updateMatchReadyStatus(prisma, bracket.id);

  return {
    advanced: true,
    message: results.length > 0 ? results.join('; ') : 'Match completed',
  };
}

/**
 * Advances a competitor to a specific match
 */
async function advanceToMatch(
  prisma: PrismaClient,
  matchId: string,
  competitorId: string,
  fromMatchNumber: number
): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
  });

  if (!match) return;

  // Determine which slot to fill based on the match structure
  // Generally, lower match numbers go to competitor1, higher to competitor2
  const updateData: { competitor1Id?: string; competitor2Id?: string } = {};

  if (!match.competitor1Id) {
    updateData.competitor1Id = competitorId;
  } else if (!match.competitor2Id) {
    updateData.competitor2Id = competitorId;
  } else {
    // Both slots filled - this shouldn't happen in normal flow
    console.warn(`Match ${matchId} already has both competitors`);
    return;
  }

  await prisma.match.update({
    where: { id: matchId },
    data: updateData,
  });
}

/**
 * Updates the status of matches based on competitor availability
 */
async function updateMatchReadyStatus(
  prisma: PrismaClient,
  bracketId: string
): Promise<void> {
  const matches = await prisma.match.findMany({
    where: { bracketId },
  });

  for (const match of matches) {
    if (match.status === 'completed') continue;

    const hasBothCompetitors = match.competitor1Id && match.competitor2Id;
    const hasBye = (match.competitor1Id && !match.competitor2Id) ||
                   (!match.competitor1Id && match.competitor2Id);

    let newStatus = match.status;

    if (hasBothCompetitors) {
      newStatus = 'ready';
    } else if (hasBye && match.roundNumber === 1) {
      // First round BYE - auto-advance
      newStatus = 'bye';
    } else if (!match.competitor1Id && !match.competitor2Id) {
      newStatus = 'pending';
    }

    if (newStatus !== match.status) {
      await prisma.match.update({
        where: { id: match.id },
        data: { status: newStatus },
      });
    }
  }
}

/**
 * Handles BYE matches by automatically advancing the competitor
 */
export async function handleByeMatches(
  prisma: PrismaClient,
  bracketId: string
): Promise<number> {
  const bracket = await prisma.bracket.findUnique({
    where: { id: bracketId },
    include: { matches: true },
  });

  if (!bracket) return 0;

  const structure: BracketStructure = JSON.parse(bracket.structure);
  let byesHandled = 0;

  // Find first round matches with BYEs
  const firstRoundMatches = bracket.matches.filter(
    m => m.roundNumber === 1 && m.bracketType === 'winners'
  );

  for (const match of firstRoundMatches) {
    const hasOnlyOne = (match.competitor1Id && !match.competitor2Id) ||
                       (!match.competitor1Id && match.competitor2Id);

    if (hasOnlyOne && match.status !== 'completed') {
      const winnerId = match.competitor1Id || match.competitor2Id;

      if (winnerId) {
        // Mark as completed with BYE winner
        await prisma.match.update({
          where: { id: match.id },
          data: {
            winnerId,
            status: 'completed',
            notes: 'BYE',
          },
        });

        // Advance the winner
        await advanceWinner(prisma, {
          ...match,
          winnerId,
          status: 'completed',
        } as Match & { bracketId: string });

        byesHandled++;
      }
    }
  }

  return byesHandled;
}

/**
 * Gets the current standings/placements from a bracket
 */
export async function getBracketPlacements(
  prisma: PrismaClient,
  bracketId: string
): Promise<{ place: number; competitorId: string }[]> {
  const bracket = await prisma.bracket.findUnique({
    where: { id: bracketId },
    include: { matches: true },
  });

  if (!bracket) return [];

  const placements: { place: number; competitorId: string }[] = [];

  // Find finals matches
  const grandFinals = bracket.matches.find(m => m.matchNumber === 14);
  const resetMatch = bracket.matches.find(m => m.matchNumber === 15);
  const losersFinal = bracket.matches.find(m => m.matchNumber === 13);

  // Determine 1st and 2nd place
  if (resetMatch?.status === 'completed' && resetMatch.winnerId) {
    // Reset match was played
    placements.push({ place: 1, competitorId: resetMatch.winnerId });
    const secondId = resetMatch.competitor1Id === resetMatch.winnerId
      ? resetMatch.competitor2Id
      : resetMatch.competitor1Id;
    if (secondId) placements.push({ place: 2, competitorId: secondId });
  } else if (grandFinals?.status === 'completed' && grandFinals.winnerId) {
    // Grand finals decided it (winners bracket champion won)
    placements.push({ place: 1, competitorId: grandFinals.winnerId });
    const secondId = grandFinals.competitor1Id === grandFinals.winnerId
      ? grandFinals.competitor2Id
      : grandFinals.competitor1Id;
    if (secondId) placements.push({ place: 2, competitorId: secondId });
  }

  // 3rd place - loser of losers final
  if (losersFinal?.status === 'completed' && losersFinal.winnerId) {
    const thirdId = losersFinal.competitor1Id === losersFinal.winnerId
      ? losersFinal.competitor2Id
      : losersFinal.competitor1Id;
    if (thirdId) placements.push({ place: 3, competitorId: thirdId });
  }

  // Also 3rd place - loser of winners final who lost in losers bracket
  // (In double elimination, there can be two 3rd place finishers)
  const winnersFinal = bracket.matches.find(m => m.matchNumber === 7);
  if (winnersFinal?.status === 'completed' && winnersFinal.winnerId) {
    const losersFinalist = winnersFinal.competitor1Id === winnersFinal.winnerId
      ? winnersFinal.competitor2Id
      : winnersFinal.competitor1Id;

    // Check if this person lost before losers finals
    if (losersFinalist && !placements.some(p => p.competitorId === losersFinalist)) {
      // They got 3rd place (tied)
      placements.push({ place: 3, competitorId: losersFinalist });
    }
  }

  return placements;
}

/**
 * Enriched placements: returns { place, registrationId, registration: { competitor: {...} } }
 * shaped like the Prisma Placement model the Results page expects.
 */
export async function getBracketPlacementsEnriched(
  prisma: PrismaClient,
  bracketId: string
): Promise<Array<{ place: number; registrationId: string; registration: { id: string; competitor: { id: string; firstName: string; lastName: string; schoolDojang: string | null; belt: string } } }>> {
  const base = await getBracketPlacements(prisma, bracketId);
  if (base.length === 0) return [];

  // Bulk-load the registrations+competitors for these placements
  const regIds = base.map(p => p.competitorId);
  const registrations = await prisma.registration.findMany({
    where: { id: { in: regIds } },
    include: { competitor: true },
  });
  const regById = new Map(registrations.map(r => [r.id, r]));

  return base
    .map((p) => {
      const reg = regById.get(p.competitorId);
      if (!reg) return null;
      return {
        place: p.place,
        registrationId: reg.id,
        registration: {
          id: reg.id,
          competitor: {
            id: reg.competitor.id,
            firstName: reg.competitor.firstName,
            lastName: reg.competitor.lastName,
            schoolDojang: reg.competitor.schoolDojang,
            belt: reg.competitor.belt,
          },
        },
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}

/**
 * Checks if a bracket is complete
 */
export function isBracketComplete(
  matches: { status: string; matchNumber: number }[]
): boolean {
  const grandFinals = matches.find(m => m.matchNumber === 14);
  const resetMatch = matches.find(m => m.matchNumber === 15);

  if (!grandFinals) return false;

  // If grand finals is complete and reset match exists but is pending,
  // check if reset was needed
  if (grandFinals.status === 'completed') {
    if (resetMatch && resetMatch.status === 'ready') {
      // Reset match was activated but not completed
      return false;
    }
    return true;
  }

  return false;
}

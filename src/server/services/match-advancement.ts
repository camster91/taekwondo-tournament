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

  // Check if grand finals reset is needed. Prefer the named positions
  // from the bracket structure; for legacy brackets generated before
  // `positions` existed, fall back to the historical 8-person defaults
  // (14 = GF, 15 = reset). Without the fallback, a LB-champion win
  // on a legacy bracket would silently skip reset activation, and
  // the bracket would end with no clear 1st-place finish.
  const positions = structure.positions ?? {
    winnersFinal: 7,
    losersFinal: 13,
    grandFinals: 14,
    reset: 15,
  };
  const grandFinalsNumber = positions.grandFinals ?? null;
  const resetNumber = positions.reset ?? null;
  if (
    match.bracketType === 'finals' &&
    grandFinalsNumber !== null &&
    match.matchNumber === grandFinalsNumber
  ) {
    // Grand finals - check if losers bracket champion won
    // The winner from losers bracket is competitor2 in grand finals
    const needsReset = match.winnerId === match.competitor2Id;

    if (needsReset && resetNumber !== null) {
      // Activate reset match
      const resetMatch = bracket.matches.find(m => m.matchNumber === resetNumber);
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
    // Both slots filled - this can happen on legitimate re-runs of
    // the bracket generator, so we log at debug rather than warn to
    // avoid spamming logs in normal operation. Operators investigating
    // an actual bug can enable DEBUG to see it.
    if (process.env.DEBUG) {
      console.log(`[match-advancement] Match ${matchId} already has both competitors`);
    }
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
 * Position names from the bracket structure. Mirrors the field on
 * `BracketStructure.positions`. Kept as a local type alias so this
 * helper can be imported + unit-tested without dragging the full
 * BracketStructure shape in.
 */
export interface BracketPositions {
  winnersFinal: number | null;
  losersFinal: number | null;
  grandFinals: number | null;
  reset: number | null;
}

/**
 * Minimal shape of a match record the placement resolver needs.
 * Compatible with both Prisma `Match` rows and in-memory `MatchData`
 * from the generator.
 */
interface PlacementMatch {
  matchNumber: number;
  bracketType: 'winners' | 'losers' | 'finals';
  status: string;
  winnerId: string | null;
  competitor1Id: string | null;
  competitor2Id: string | null;
}

/**
 * Resolve final placements from a set of matches + the bracket's
 * named positions. Pure function — no DB access, no fallbacks to
 * magic match numbers. The caller is responsible for loading the
 * matches and deciding what to do if `positions` is absent (see
 * the legacy-fallback comment below).
 *
 * Returns placements in 1st/2nd/3rd order. Empty array when the
 * grand final hasn't been decided yet. Two 3rd-place entries can
 * appear in double elimination (the loser of the winners final who
 * lost again in the losers bracket, and the loser of the losers
 * final) — both are valid `place: 3` rows.
 */
export function resolvePlacements(
  matches: PlacementMatch[],
  positions: BracketPositions | null | undefined
): { place: number; competitorId: string }[] {
  // No positions = we can't reliably map roles to match numbers.
  // Each bracket size has different positions; without the named
  // map, any guess is a guess. The legacy fallback for 8-person DE
  // (13/14/15) lives in the caller — keep this helper honest.
  if (!positions) return [];

  const byNum = new Map<number, PlacementMatch>();
  for (const m of matches) byNum.set(m.matchNumber, m);

  const gf = positions.grandFinals !== null ? byNum.get(positions.grandFinals) : undefined;
  const reset = positions.reset !== null ? byNum.get(positions.reset) : undefined;
  const lf = positions.losersFinal !== null ? byNum.get(positions.losersFinal) : undefined;

  const placements: { place: number; competitorId: string }[] = [];
  const placed = new Set<string>();

  const pushPlacement = (place: number, competitorId: string | null) => {
    if (!competitorId || placed.has(competitorId)) return;
    placed.add(competitorId);
    placements.push({ place, competitorId });
  };

  const opponentOf = (m: PlacementMatch, winnerId: string): string | null =>
    m.competitor1Id === winnerId ? m.competitor2Id : m.competitor1Id;

  // Reset match takes precedence — when it was played, it decides
  // both 1st and 2nd (because by definition the LB champion had to
  // beat the WB champion to force a reset).
  if (reset?.status === 'completed' && reset.winnerId) {
    pushPlacement(1, reset.winnerId);
    pushPlacement(2, opponentOf(reset, reset.winnerId));
  } else if (gf?.status === 'completed' && gf.winnerId) {
    pushPlacement(1, gf.winnerId);
    pushPlacement(2, opponentOf(gf, gf.winnerId));
  }

  // 3rd place: loser of the losers final (if there is one)
  if (lf?.status === 'completed' && lf.winnerId) {
    pushPlacement(3, opponentOf(lf, lf.winnerId));
  }

  // In DE there can be a second 3rd-place finisher — the loser of
  // the winners final who then lost again in the losers bracket.
  //
  // This requires the WB-final loser to have actually competed in
  // the losers bracket. For small brackets (N=4 and N=6) the
  // losers bracket has only a single round (L R1) reserved for
  // the W R1 losers — the W-final loser drops out with no LB
  // entry. We detect this by checking whether the W-final loser
  // appears as a participant in any completed losers-bracket match.
  const wf = positions.winnersFinal !== null ? byNum.get(positions.winnersFinal) : undefined;
  if (wf?.status === 'completed' && wf.winnerId) {
    const wfLoser = opponentOf(wf, wf.winnerId);
    if (wfLoser && !placed.has(wfLoser)) {
      const competedInLosers = matches.some(
        (m) =>
          m.bracketType === 'losers' &&
          m.status === 'completed' &&
          (m.competitor1Id === wfLoser || m.competitor2Id === wfLoser)
      );
      if (competedInLosers) {
        placements.push({ place: 3, competitorId: wfLoser });
        placed.add(wfLoser);
      }
    }
  }

  return placements;
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

  const structure: BracketStructure | null = (() => {
    try { return JSON.parse(bracket.structure); } catch { return null; }
  })();

  // Legacy fallback: brackets generated before `positions` existed
  // (pre-fix #89) don't have the named map. The historical lookup
  // (13/14/15) was specifically for the 8-person DE, which is what
  // the old code hardcoded everywhere. For those legacy brackets we
  // synthesize a positions object from the historical defaults so
  // `resolvePlacements` can handle them uniformly.
  let positions: BracketPositions | null | undefined = structure?.positions;
  if (!positions) {
    positions = { winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15 };
  }

  return resolvePlacements(
    bracket.matches.map((m) => ({
      matchNumber: m.matchNumber,
      bracketType: m.bracketType as PlacementMatch['bracketType'],
      status: m.status,
      winnerId: m.winnerId,
      competitor1Id: m.competitor1Id,
      competitor2Id: m.competitor2Id,
    })),
    positions
  );
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
 * Minimal match shape for completion checks. Same as `PlacementMatch`
 * minus the slots we don't need.
 */
interface CompletionMatch {
  matchNumber: number;
  status: string;
}

/**
 * Pure check: is the bracket complete?
 *
 * The bracket is complete when the grand final has been decided.
 * If a reset match exists and is `ready` (activated but not yet
 * played), the bracket is NOT complete — the LB champion forced a
 * rematch and we're waiting for the reset result.
 *
 * Takes the named `positions` rather than guessing match numbers.
 * Legacy callers that don't have positions can synthesize the
 * 8-person defaults.
 */
export function isBracketCompletePure(
  matches: CompletionMatch[],
  positions: BracketPositions | null | undefined
): boolean {
  if (!positions) return false;
  const byNum = new Map<number, CompletionMatch>();
  for (const m of matches) byNum.set(m.matchNumber, m);

  const gf = positions.grandFinals !== null ? byNum.get(positions.grandFinals) : undefined;
  const reset = positions.reset !== null ? byNum.get(positions.reset) : undefined;

  if (!gf) return false;

  if (gf.status === 'completed') {
    // If the reset was activated (status === 'ready') but not yet
    // played, the bracket is mid-reset — not complete.
    if (reset && reset.status === 'ready') return false;
    return true;
  }

  return false;
}

/**
 * Checks if a bracket is complete
 */
export function isBracketComplete(
  matches: { status: string; matchNumber: number }[],
  structure?: BracketStructure | null
): boolean {
  const positions = structure?.positions ?? {
    winnersFinal: 7,
    losersFinal: 13,
    grandFinals: 14,
    reset: 15,
  };
  return isBracketCompletePure(matches, positions);
}

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
 * Minimal shape of a match record the slot-resolver needs to decide
 * which slot (competitor1 vs competitor2) the undone match populated.
 */
interface NextMatchCandidate {
  matchNumber: number;
  bracketType: 'winners' | 'losers' | 'finals';
  competitor1Id: string | null;
  competitor2Id: string | null;
}

/**
 * Given the bracket structure and the match being undone, return the
 * downstream matches that this result could have populated, plus
 * the specific slot (competitor1 or competitor2) per match that
 * was populated by THIS match's competitor. Pure — the caller is
 * responsible for loading the actual `NextMatchCandidate` rows from
 * the DB and matching by (matchNumber, bracketType).
 *
 * Returns an empty array if the structure has no `nextWinnerMatch`
 * or `nextLoserMatch` link for this match (e.g. the match is the
 * grand final, or the bracket pre-dates the structure field).
 *
 * Slot assignment rules (mirrors the generator + advanceWinner):
 *   - nextWinnerMatch gets slot `competitor1` if empty, else `competitor2`
 *   - nextLoserMatch gets slot `competitor1` if empty, else `competitor2`
 *
 * So we report the slot the match's competitor WOULD have filled.
 * The caller compares this against the actual DB state to decide
 * whether to null the slot or leave it alone (in case a different
 * match beat this one to the slot).
 *
 * Note: `MatchData` doesn't carry `bracketType` directly — the type
 * is implicit from which array the match lives in. We look the
 * target up across all three arrays and use the first hit, with
 * a tiebreaker preference (finals > losers > winners) in case the
 * same `matchNumber` appears in multiple arrays (it shouldn't in a
 * well-formed bracket, but defensive lookup costs us nothing).
 */
type BracketType = 'winners' | 'losers' | 'finals';
type Slot = 'competitor1' | 'competitor2';
type SlotTarget = { matchNumber: number; bracketType: BracketType; slot: Slot };

function findMatchAcross(structure: BracketStructure, matchNumber: number): { match: MatchData; bracketType: BracketType } | null {
  // Prefer finals → losers → winners for the same matchNumber.
  // (Real brackets don't reuse matchNumbers across arrays.)
  for (const [arr, bt] of [
    [structure.finals, 'finals'] as const,
    [structure.losers, 'losers'] as const,
    [structure.winners, 'winners'] as const,
  ]) {
    const found = arr.find((m) => m.matchNumber === matchNumber);
    if (found) return { match: found, bracketType: bt };
  }
  return null;
}

export function resolveNextMatchSlots(
  undone: { matchNumber: number; bracketType: BracketType },
  structure: BracketStructure | null | undefined
): SlotTarget[] {
  if (!structure) return [];
  const here = findMatchAcross(structure, undone.matchNumber);
  if (!here) return [];
  const out: SlotTarget[] = [];

  if (here.match.nextWinnerMatch !== undefined) {
    const target = findMatchAcross(structure, here.match.nextWinnerMatch);
    if (target) {
      // The advanceToMatch() helper fills competitor1 first, then
      // competitor2. We mirror that here — but the caller decides
      // whether to actually null the slot based on what's currently
      // in the DB.
      out.push({ matchNumber: target.match.matchNumber, bracketType: target.bracketType, slot: 'competitor1' });
      out.push({ matchNumber: target.match.matchNumber, bracketType: target.bracketType, slot: 'competitor2' });
    }
  }
  // Losers-bracket drops only happen from winners-bracket matches.
  // The losers bracket's own matches never feed into another losers
  // match via nextLoserMatch — they have nextWinnerMatch only (into
  // either the L final or the grand final).
  if (here.match.nextLoserMatch !== undefined && undone.bracketType === 'winners') {
    const target = findMatchAcross(structure, here.match.nextLoserMatch);
    if (target) {
      out.push({ matchNumber: target.match.matchNumber, bracketType: target.bracketType, slot: 'competitor1' });
      out.push({ matchNumber: target.match.matchNumber, bracketType: target.bracketType, slot: 'competitor2' });
    }
  }
  return out;
}

/**
 * Given the undo target (which slots downstream matches WOULD have
 * been filled) and the actual downstream DB state, decide which
 * slots to null. Only null the slot whose current value matches the
 * undone match's competitor — this prevents over-resetting a slot
 * that was filled by a different upstream match.
 *
 * Returns the list of (matchId, field) pairs to null.
 */
/**
 * Given the undo target (which slots downstream matches WOULD have
 * been filled) and the actual downstream DB state, decide which
 * slots to null. Only null the slot whose current value matches the
 * undone match's competitor — this prevents over-resetting a slot
 * that was filled by a different upstream match.
 *
 * Returns the list of (matchId, field) pairs to null.
 *
 * Skips targets whose downstream candidate is missing from the
 * DB — this can happen mid-tournament if a match was deleted or
 * if the bracket structure references a match that hasn't been
 * created yet.
 */
export function pickSlotsToNull(
  undoneCompetitorIds: string[],
  downstreamCandidates: NextMatchCandidate[],
  undoTargets: { matchNumber: number; bracketType: 'winners' | 'losers' | 'finals'; slot: 'competitor1' | 'competitor2' }[]
): { matchNumber: number; bracketType: 'winners' | 'losers' | 'finals'; field: 'competitor1Id' | 'competitor2Id' }[] {
  if (undoneCompetitorIds.length === 0) return [];
  const undoSet = new Set(undoneCompetitorIds);
  const out: { matchNumber: number; bracketType: 'winners' | 'losers' | 'finals'; field: 'competitor1Id' | 'competitor2Id' }[] = [];
  for (const target of undoTargets) {
    const candidate = downstreamCandidates.find(
      (c) => c.matchNumber === target.matchNumber && c.bracketType === target.bracketType
    );
    if (!candidate) continue;
    const value = target.slot === 'competitor1' ? candidate.competitor1Id : candidate.competitor2Id;
    if (value && undoSet.has(value)) {
      out.push({ matchNumber: target.matchNumber, bracketType: target.bracketType, field: target.slot === 'competitor1' ? 'competitor1Id' : 'competitor2Id' });
    }
  }
  return out;
}

// ─── Match status state machine ──────────────────────────────────────

export type MatchStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'bye';

/**
 * Match state machine — allowed status transitions for a single
 * match. Pure function: caller passes the current state and the
 * requested new state and gets back whether the transition is valid.
 *
 * The map captures the bracket-aware rules:
 *   - `bye` is terminal-ish (you can only go back to `pending`)
 *     because BYE matches are auto-completed by `handleByeMatches`.
 *   - `completed` can revert to `pending` (only when `winnerId` is
 *     being cleared; caller must check separately) or `in_progress`
 *     (re-open for a scoring correction).
 *   - `ready → pending` is allowed because a no-show / withdrawal
 *     can pull a competitor out of the bracket after they're set.
 *   - `in_progress → pending` is allowed for the same reason.
 *   - `pending → bye` is allowed when one slot is empty (the match
 *     was waiting for a competitor who never showed; the bracket
 *     auto-advances the present one).
 */
const STATUS_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  pending: ['ready', 'in_progress', 'completed', 'bye'],
  ready: ['in_progress', 'completed', 'pending'],
  in_progress: ['completed', 'pending'],
  completed: ['pending', 'in_progress'],
  bye: ['pending'],
};

/**
 * Pure check: is the status transition `from` -> `to` valid?
 * Returns `{ ok: true }` when valid, `{ ok: false, allowed: [...] }`
 * when invalid (caller can use `allowed` to surface a useful error).
 */
export function isValidStatusTransition(
  from: MatchStatus,
  to: MatchStatus
): { ok: true } | { ok: false; allowed: MatchStatus[] } {
  if (from === to) {
    // Self-transitions are no-ops; treat them as valid so the
    // route doesn't error on a no-op PATCH.
    return { ok: true };
  }
  const allowed = STATUS_TRANSITIONS[from] ?? [];
  return allowed.includes(to) ? { ok: true } : { ok: false, allowed };
}

/**
 * Result of validating a full match-status PATCH (status + winnerId +
 * competitor slot state). Pure function — caller is responsible for
 * loading the match row and slot state, then applying the resulting
 * `update` data.
 */
export type StatusValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'invalid_transition' | 'missing_winner' | 'stale_winner' | 'inconsistent_slot_state';
      message: string;
      allowed?: MatchStatus[];
    };

interface ValidateStatusInput {
  from: MatchStatus;
  to: MatchStatus;
  /** The `winnerId` being set in this PATCH (or undefined if not changing). */
  winnerId?: string | null;
  /** The `winnerId` currently on the match (before this PATCH). */
  currentWinnerId: string | null;
  /** Whether both competitor slots are filled right now. */
  bothSlotsFilled: boolean;
  /** Whether at least one competitor slot is filled. */
  someSlotFilled: boolean;
  /**
   * Whether the caller's request is trying to clear winnerId. We
   * infer this when `winnerId === null` is explicitly passed; if
   * `winnerId` is undefined we treat it as "no change".
   */
  clearingWinnerId: boolean;
}

export function validateMatchStatusTransition(input: ValidateStatusInput): StatusValidationResult {
  const { from, to, winnerId, currentWinnerId, bothSlotsFilled, someSlotFilled, clearingWinnerId } = input;

  // 1. Transition validity.
  const transition = isValidStatusTransition(from, to);
  if (!transition.ok) {
    return {
      ok: false,
      code: 'invalid_transition',
      message: `Invalid status transition: ${from} -> ${to}. Allowed: ${transition.allowed.join(', ') || '(none)'}`,
      allowed: transition.allowed,
    };
  }

  // 2. Completing requires a winnerId, either pre-existing or in
  // this PATCH.
  if (to === 'completed') {
    const finalWinnerId = winnerId !== undefined ? winnerId : currentWinnerId;
    if (!finalWinnerId) {
      return {
        ok: false,
        code: 'missing_winner',
        message: 'Cannot mark match completed without a winnerId',
      };
    }
  }

  // 3. Going back to `pending` from `completed` must clear the winner.
  if (to === 'pending' && from === 'completed') {
    const finalWinnerId = winnerId !== undefined ? winnerId : currentWinnerId;
    if (finalWinnerId !== null) {
      return {
        ok: false,
        code: 'stale_winner',
        message: 'Cannot revert a completed match to pending without clearing winnerId (set winnerId: null)',
      };
    }
  }

  // 4. Slot state must be consistent with the target status.
  if (to === 'in_progress') {
    // A match in progress must have both competitors present.
    if (!bothSlotsFilled) {
      return {
        ok: false,
        code: 'inconsistent_slot_state',
        message: 'Cannot mark match in_progress with one or both competitor slots empty',
      };
    }
  }
  if (to === 'completed') {
    // Completed matches must have both slots (a BYE is auto-completed
    // via `handleByeMatches` with one slot; explicit PATCH must
    // have both). The check below is intentionally strict — if you
    // want to advance a BYE, use `handleByeMatches`.
    if (!bothSlotsFilled) {
      return {
        ok: false,
        code: 'inconsistent_slot_state',
        message: 'Cannot mark match completed with one or both competitor slots empty (use handleByeMatches for BYEs)',
      };
    }
  }
  if (to === 'bye') {
    // BYE = exactly one competitor (the other never showed).
    if (!someSlotFilled || bothSlotsFilled) {
      return {
        ok: false,
        code: 'inconsistent_slot_state',
        message: 'BYE status requires exactly one competitor slot filled (the other is a no-show)',
      };
    }
  }

  // 5. `clearingWinnerId` to a non-pending/in_progress state is suspicious.
  // If the caller is clearing winnerId but the transition isn't a
  // revert (e.g., pending -> ready with cleared winnerId), accept it
  // but flag — the winnerId will simply be null on the next read.

  // Silence unused-var warning for clearingWinnerId; we keep it in
  // the API surface for future validation rules.
  void clearingWinnerId;

  return { ok: true };
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

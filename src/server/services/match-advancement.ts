// Match advancement logic for elimination brackets (double + single)
import type { PrismaClient, Prisma, Match } from '@prisma/client';
import { BracketStructure, MatchData } from './bracket-generator.js';
import { AppError, ErrorCode } from '../utils/errors.js';

export interface AdvancementResult {
  advanced: boolean;
  nextMatchId?: string;
  loserNextMatchId?: string;
  message: string;
}

/** Either the root client or an interactive-transaction client. */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Raised when a result (or a correction / undo of one) would have to
 * rewrite a downstream match that has already started or finished.
 * Surfaces as HTTP 409 through the global error handler.
 */
export class BracketAdvancementConflictError extends AppError {
  constructor(message: string) {
    super(message, ErrorCode.INVALID_MATCH_UPDATE, 409, {
      recoverable: true,
      suggestion: 'Undo or reopen the downstream match first, then retry this change.',
    });
    this.name = 'BracketAdvancementConflictError';
  }
}

// ─── Pure advancement engine ─────────────────────────────────────────
//
// The bracket is treated as a dataflow graph: every non-first-round
// match has "feeders" (the winner or loser of an upstream match) and
// each feeder owns one fixed slot. `computeBracketSync` reconciles the
// stored match rows with what the graph says they should contain:
//
//   * A slot whose feeder is decided holds that feeder's outcome
//     (possibly "nobody" when the feeder was a bye).
//   * A slot whose feeder is undecided is empty.
//   * A match whose feeders are all decided and which ends up with one
//     competitor is auto-completed as a BYE for that competitor; with
//     zero competitors it is auto-completed with no winner, and the
//     "nobody" propagates downstream.
//   * `pending` / `bye` matches with both competitors become `ready`.
//     `in_progress` is never touched.
//
// Because the target state is a pure function of the upstream results,
// re-submitting a result is idempotent, correcting a result replaces
// the old competitor downstream, and undoing a result clears it. When
// a change would rewrite a match that has already started (or was
// really played) the engine refuses with a conflict instead of
// silently corrupting the bracket. Slots are compared as a set, so
// brackets advanced by the old fill-first-empty code (slot order may
// differ) are accepted as-is.

type Outcome = 'winner' | 'loser';
interface Feeder { source: number; outcome: Outcome }

/** Minimal match row the engine needs. Compatible with Prisma `Match`. */
export interface EngineMatch {
  id: string;
  matchNumber: number;
  bracketType: string;
  status: string;
  winnerId: string | null;
  competitor1Id: string | null;
  competitor2Id: string | null;
  notes?: string | null;
}

export interface EngineUpdate {
  id: string;
  matchNumber: number;
  bracketType: string;
  data: {
    competitor1Id?: string | null;
    competitor2Id?: string | null;
    winnerId?: string | null;
    status?: string;
    notes?: string | null;
  };
}

const BYE_NOTE = 'BYE';

/**
 * For every match number, the ordered list of feeders. Index 0 feeds
 * `competitor1`, index 1 feeds `competitor2`. Winner feeds come
 * before loser feeds, then by source match number — so the grand
 * final gets the winners-bracket champion in slot 1 and the losers-
 * bracket champion in slot 2, and a losers drop-down match gets the
 * losers-bracket survivor in slot 1 and the dropping loser in slot 2.
 */
export function buildFeederMap(structure: BracketStructure): Map<number, Feeder[]> {
  const map = new Map<number, Feeder[]>();
  const add = (target: number, feeder: Feeder) => {
    const list = map.get(target) ?? [];
    list.push(feeder);
    map.set(target, list);
  };
  for (const m of structure.winners ?? []) {
    if (m.nextWinnerMatch != null) add(m.nextWinnerMatch, { source: m.matchNumber, outcome: 'winner' });
    if (m.nextLoserMatch != null) add(m.nextLoserMatch, { source: m.matchNumber, outcome: 'loser' });
  }
  for (const m of [...(structure.losers ?? []), ...(structure.finals ?? [])]) {
    if (m.nextWinnerMatch != null) add(m.nextWinnerMatch, { source: m.matchNumber, outcome: 'winner' });
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.outcome !== b.outcome) return a.outcome === 'winner' ? -1 : 1;
      return a.source - b.source;
    });
  }
  return map;
}

/** Grand-final / reset match numbers, tolerating legacy structures without `positions`. */
function finalsPositions(structure: BracketStructure): { grandFinals: number | null; reset: number | null } {
  const finals = structure.finals ?? [];
  if (structure.positions) {
    return { grandFinals: structure.positions.grandFinals, reset: structure.positions.reset };
  }
  return {
    grandFinals: finals[0]?.matchNumber ?? null,
    reset: finals[1]?.matchNumber ?? null,
  };
}

/** A match that was auto-resolved as a BYE (never actually contested). */
function isAutoBye(m: EngineMatch): boolean {
  return m.status === 'completed' && m.notes === BYE_NOTE && !(m.competitor1Id && m.competitor2Id);
}

/** Has this match been contested (so its competitors must not be rewritten)? */
function isStarted(m: EngineMatch): boolean {
  return m.status === 'in_progress' || (m.status === 'completed' && !isAutoBye(m));
}

function outcomeOf(m: EngineMatch | undefined, outcome: Outcome): { resolved: boolean; id: string | null } {
  if (!m || m.status !== 'completed') return { resolved: false, id: null };
  if (outcome === 'winner') return { resolved: true, id: m.winnerId };
  if (!m.winnerId) return { resolved: true, id: null };
  return {
    resolved: true,
    id: m.winnerId === m.competitor1Id ? m.competitor2Id : m.competitor1Id,
  };
}

function sameSlots(a: (string | null)[], b: (string | null)[]): boolean {
  const norm = (x: (string | null)[]) => x.map((v) => v ?? '').sort().join('\u0000');
  return norm(a) === norm(b);
}

function label(m: EngineMatch): string {
  return `${m.bracketType} match ${m.matchNumber}`;
}

function startedVerb(m: EngineMatch): string {
  return m.status === 'in_progress' ? 'started' : 'been completed';
}

/**
 * Pure reconciliation. Returns the row updates needed to bring the
 * bracket in line with its results. Throws
 * `BracketAdvancementConflictError` if a started match would change.
 */
export function computeBracketSync(
  structure: BracketStructure | null | undefined,
  matches: EngineMatch[]
): EngineUpdate[] {
  const state = new Map<number, EngineMatch>();
  for (const m of matches) state.set(m.matchNumber, { ...m });
  const updates = new Map<string, EngineUpdate>();
  const apply = (m: EngineMatch, data: EngineUpdate['data']) => {
    Object.assign(m, data);
    const existing = updates.get(m.id);
    if (existing) Object.assign(existing.data, data);
    else updates.set(m.id, { id: m.id, matchNumber: m.matchNumber, bracketType: m.bracketType, data: { ...data } });
  };

  const ordered = [...state.values()].sort((a, b) => a.matchNumber - b.matchNumber);
  const isElimination = !!structure && (structure.finals?.length ?? 0) > 0;

  if (!structure || !isElimination) {
    // Round robin / pool play: no advancement graph. Only promote
    // pending matches that have both competitors.
    for (const m of ordered) {
      if ((m.status === 'pending' || m.status === 'bye') && m.competitor1Id && m.competitor2Id) {
        apply(m, { status: 'ready' });
      }
    }
    return [...updates.values()];
  }

  const feeders = buildFeederMap(structure);
  const { grandFinals, reset } = finalsPositions(structure);
  const resetNumber = reset !== null && reset !== grandFinals ? reset : null;

  // Iterate to a fixed point. Each pass settles at least one more
  // level of the graph, so the bound is generous.
  for (let pass = 0; pass < ordered.length + 2; pass++) {
    let changed = false;
    for (const m of ordered) {
      if (m.matchNumber === resetNumber) continue;
      const fs = feeders.get(m.matchNumber) ?? [];
      let allResolved = true;

      if (fs.length > 0) {
        const desired: (string | null)[] = [null, null];
        fs.forEach((f, i) => {
          const o = outcomeOf(state.get(f.source), f.outcome);
          if (!o.resolved) allResolved = false;
          else if (i < 2) desired[i] = o.id;
        });
        if (!sameSlots(desired, [m.competitor1Id, m.competitor2Id])) {
          if (isStarted(m)) {
            throw new BracketAdvancementConflictError(
              `Cannot change the competitors of ${label(m)}: it has already ${startedVerb(m)}.`
            );
          }
          const data: EngineUpdate['data'] = { competitor1Id: desired[0], competitor2Id: desired[1] };
          if (m.status === 'completed') {
            // Auto-BYE whose entrant changed: reopen so it re-resolves.
            data.status = 'pending';
            data.winnerId = null;
            data.notes = null;
          } else if (m.status === 'ready' && !(desired[0] && desired[1])) {
            data.status = 'pending';
          }
          apply(m, data);
          changed = true;
        }
      }

      if (m.status !== 'completed' && m.status !== 'in_progress') {
        const present = [m.competitor1Id, m.competitor2Id].filter((c): c is string => !!c);
        if (present.length === 2) {
          if (m.status !== 'ready') {
            apply(m, { status: 'ready' });
            changed = true;
          }
        } else if (allResolved) {
          apply(m, { status: 'completed', winnerId: present[0] ?? null, notes: BYE_NOTE });
          changed = true;
        } else if (m.status === 'ready') {
          apply(m, { status: 'pending' });
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Bracket reset: only live when the losers-bracket champion won the
  // grand final. Correcting or undoing the grand final deactivates it.
  if (resetNumber !== null && grandFinals !== null) {
    const resetMatch = state.get(resetNumber);
    const gf = state.get(grandFinals);
    if (resetMatch && gf) {
      let desired: (string | null)[] = [null, null];
      if (gf.status === 'completed' && gf.winnerId && gf.competitor1Id && gf.competitor2Id) {
        const lbFeeder = (feeders.get(grandFinals) ?? [])[1];
        const lbChampion = (lbFeeder ? outcomeOf(state.get(lbFeeder.source), lbFeeder.outcome).id : null)
          ?? gf.competitor2Id;
        if (gf.winnerId === lbChampion) {
          const wbChampion = gf.competitor1Id === lbChampion ? gf.competitor2Id : gf.competitor1Id;
          desired = [wbChampion, lbChampion];
        }
      }
      if (!sameSlots(desired, [resetMatch.competitor1Id, resetMatch.competitor2Id])) {
        if (isStarted(resetMatch)) {
          throw new BracketAdvancementConflictError(
            `Cannot change the bracket reset (${label(resetMatch)}): it has already ${startedVerb(resetMatch)}.`
          );
        }
        apply(resetMatch, {
          competitor1Id: desired[0],
          competitor2Id: desired[1],
          winnerId: null,
          status: desired[0] && desired[1] ? 'ready' : 'pending',
        });
      } else if (desired[0] && desired[1] && (resetMatch.status === 'pending' || resetMatch.status === 'bye')) {
        apply(resetMatch, { status: 'ready' });
      }
    }
  }

  return [...updates.values()];
}

/**
 * Serialize all advancement for one bracket. Takes a row lock on the
 * Bracket row for the rest of the surrounding transaction, so two
 * scorekeepers finishing sibling matches can't read-then-write the
 * same downstream match concurrently (READ COMMITTED lost update).
 * Call it FIRST in the transaction, before touching any match row.
 * No-op on clients without raw-query support (unit-test mocks).
 */
export async function lockBracket(prisma: PrismaLike, bracketId: string): Promise<void> {
  const client = prisma as unknown as { $queryRaw?: unknown };
  if (typeof client.$queryRaw !== 'function') return;
  await (prisma as PrismaClient).$queryRaw`SELECT "id" FROM "Bracket" WHERE "id" = ${bracketId} FOR UPDATE`;
}

function parseStructure(json: string | null | undefined): BracketStructure | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BracketStructure;
  } catch {
    return null;
  }
}

/**
 * Load the bracket, reconcile it (see `computeBracketSync`) and write
 * the resulting updates. Call inside a transaction; the bracket row is
 * locked first so concurrent calls serialize.
 */
export async function syncBracketAdvancement(
  prisma: PrismaLike,
  bracketId: string
): Promise<EngineUpdate[]> {
  await lockBracket(prisma, bracketId);
  const bracket = await prisma.bracket.findUnique({
    where: { id: bracketId },
    include: { matches: true },
  });
  if (!bracket) return [];

  const updates = computeBracketSync(parseStructure(bracket.structure), bracket.matches);
  for (const u of updates) {
    await prisma.match.update({ where: { id: u.id }, data: u.data });
  }
  return updates;
}

/** Human-readable summary of engine updates (logs + audit reasons). */
export function summarizeBracketUpdates(updates: EngineUpdate[]): string {
  if (updates.length === 0) return 'No downstream changes';
  return updates
    .map((u) => {
      const parts = Object.entries(u.data).map(([k, v]) => `${k}=${v ?? 'null'}`);
      return `${u.bracketType} match ${u.matchNumber}: ${parts.join(', ')}`;
    })
    .join('; ');
}

/**
 * Propagate a match result through the bracket. Kept for existing
 * callers — it reconciles the whole bracket, so it also handles
 * corrections (winner changed) and reopened matches.
 */
export async function advanceWinner(
  prisma: PrismaLike,
  match: Pick<Match, 'bracketId'>
): Promise<AdvancementResult> {
  const updates = await syncBracketAdvancement(prisma, match.bracketId);
  return { advanced: true, message: summarizeBracketUpdates(updates) };
}

/**
 * Resolve every BYE in the bracket — first-round byes and the empty
 * slots they create further down (losers bracket included). Returns
 * the number of matches auto-completed. Runs in its own transaction
 * when given the root client.
 */
export async function handleByeMatches(
  prisma: PrismaLike,
  bracketId: string
): Promise<number> {
  const root = prisma as unknown as { $transaction?: unknown };
  const updates = typeof root.$transaction === 'function'
    ? await (prisma as PrismaClient).$transaction((tx) => syncBracketAdvancement(tx, bracketId))
    : await syncBracketAdvancement(prisma, bracketId);
  return updates.filter((u) => u.data.status === 'completed' && u.data.notes === BYE_NOTE).length;
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
 *
 * Single elimination (detected from `structure`: no losers bracket,
 * one final) awards a tied 3rd place to both semifinal losers.
 *
 * 1st/2nd are only reported once they are actually decided: while an
 * activated bracket-reset match is still unplayed, the grand final
 * result is provisional and no 1st/2nd is returned.
 */
export function resolvePlacements(
  matches: PlacementMatch[],
  positions: BracketPositions | null | undefined,
  structure?: Pick<BracketStructure, 'winners' | 'losers' | 'finals'> | null
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
  // beat the WB champion to force a reset). While an activated reset
  // is still unplayed, nobody has won yet: report no 1st/2nd.
  const resetActive = !!reset && reset !== gf && reset.status !== 'completed' && (
    reset.status === 'ready' ||
    reset.status === 'in_progress' ||
    !!reset.competitor1Id ||
    !!reset.competitor2Id
  );
  if (reset && reset !== gf && reset.status === 'completed' && reset.winnerId) {
    pushPlacement(1, reset.winnerId);
    pushPlacement(2, opponentOf(reset, reset.winnerId));
  } else if (gf?.status === 'completed' && gf.winnerId && !resetActive) {
    pushPlacement(1, gf.winnerId);
    pushPlacement(2, opponentOf(gf, gf.winnerId));
  }

  const inGrandFinal = (id: string | null) =>
    !!id && !!gf && (gf.competitor1Id === id || gf.competitor2Id === id);

  // 3rd place: loser of the losers final (if there is one). Guard
  // against tiny brackets where the "losers final" loser still plays
  // the grand final (N=2 feeds both match-1 players into the GF).
  if (lf?.status === 'completed' && lf.winnerId) {
    const lfLoser = opponentOf(lf, lf.winnerId);
    if (!inGrandFinal(lfLoser)) pushPlacement(3, lfLoser);
  }

  // Single elimination: both semifinal losers share 3rd place.
  const isSingleElim = !!structure &&
    (structure.losers?.length ?? 0) === 0 &&
    (structure.finals?.length ?? 0) === 1 &&
    positions.reset === null;
  if (isSingleElim && positions.grandFinals !== null) {
    const semis = structure.winners.filter((m) => m.nextWinnerMatch === positions.grandFinals);
    for (const semi of semis) {
      const row = byNum.get(semi.matchNumber);
      if (row?.status === 'completed' && row.winnerId && row.competitor1Id && row.competitor2Id) {
        pushPlacement(3, opponentOf(row, row.winnerId));
      }
    }
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
    if (wfLoser && !placed.has(wfLoser) && !inGrandFinal(wfLoser)) {
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
    positions,
    structure
  );
}

/**
 * Gets placements from an already-loaded bracket (structure JSON +
 * matches). Avoids the per-division DB round-trip that
 * getBracketPlacements performs when callers already have the data
 * (e.g. GET /divisions?withMatches=true).
 */
export function getBracketPlacementsFromLoaded(
  structureJson: string,
  matches: PlacementMatch[],
): { place: number; competitorId: string }[] {
  const structure: BracketStructure | null = (() => {
    try { return JSON.parse(structureJson); } catch { return null; }
  })();

  let positions: BracketPositions | null | undefined = structure?.positions;
  if (!positions) {
    positions = { winnersFinal: 7, losersFinal: 13, grandFinals: 14, reset: 15 };
  }

  return resolvePlacements(matches, positions, structure);
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
    // If the reset was activated (ready / being played) but not yet
    // completed, the bracket is mid-reset — not complete.
    if (reset && reset !== gf && (reset.status === 'ready' || reset.status === 'in_progress')) return false;
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

// Hand edits to the first-round spots of an existing elimination
// bracket: move a person to another spot (swapping if it is taken),
// take a person out (their spot becomes a BYE), or put a division
// member who is not in the bracket into an empty spot. The bracket is
// never cleared; the rest of it is re-derived by `computeBracketSync`,
// so byes resolve through and later rounds stay consistent.
//
// `planSlotEdit` is pure: it validates the edit against the current
// rows and returns the row updates plus the updated structure JSON.
// The route applies them inside a transaction holding the bracket lock.

import { AppError, ErrorCode } from '../utils/errors.js';
import type { BracketStructure, MatchData } from './bracket-generator.js';
import {
  computeBracketSync,
  BracketAdvancementConflictError,
  type EngineMatch,
  type EngineUpdate,
} from './match-advancement.js';
import { entryMatchNumbers, isSlotEditableMatch } from '../../shared/utils/bracket-slots.js';

export type SlotNumber = 1 | 2;
export interface SlotRef { matchId: string; slot: SlotNumber }

export type SlotEdit =
  | { action: 'move'; registrationId: string; from: SlotRef; to: SlotRef }
  | { action: 'remove'; registrationId: string; from: SlotRef }
  | { action: 'place'; registrationId: string; to: SlotRef };

export interface SlotEditMatch extends EngineMatch {
  score1?: string | null;
  score2?: string | null;
}

export type SlotUpdate = EngineUpdate & {
  data: EngineUpdate['data'] & { score1?: string | null; score2?: string | null };
};

export interface SlotEditEntryChange {
  matchId: string;
  matchNumber: number;
  before: MatchSnapshot;
  after: MatchSnapshot;
}

export interface MatchSnapshot {
  competitor1Id: string | null;
  competitor2Id: string | null;
  winnerId: string | null;
  status: string;
  score1: string | null;
  score2: string | null;
  notes: string | null;
}

export interface SlotEditPlan {
  /** Every row write, entry matches and downstream, merged per match. */
  updates: SlotUpdate[];
  /** The entry matches whose spots changed (one audit row each). */
  entryChanges: SlotEditEntryChange[];
  /** Downstream-only reconciliation, for the audit reason. */
  downstream: EngineUpdate[];
  /** The stored structure with the new first-round spots. */
  structure: BracketStructure;
}

const conflict = (message: string, suggestion = 'Refresh the bracket and try again.') =>
  new AppError(message, ErrorCode.INVALID_MATCH_UPDATE, 409, { recoverable: true, suggestion });
const invalid = (message: string) =>
  new AppError(message, ErrorCode.VALIDATION_ERROR, 400, { recoverable: true });

function snapshot(m: SlotEditMatch): MatchSnapshot {
  return {
    competitor1Id: m.competitor1Id,
    competitor2Id: m.competitor2Id,
    winnerId: m.winnerId,
    status: m.status,
    score1: m.score1 ?? null,
    score2: m.score2 ?? null,
    notes: m.notes ?? null,
  };
}

const field = (slot: SlotNumber) => (slot === 1 ? 'competitor1Id' : 'competitor2Id');

export function planSlotEdit(
  structure: BracketStructure | null,
  matches: SlotEditMatch[],
  edit: SlotEdit,
  divisionRegistrationIds: ReadonlySet<string>,
): SlotEditPlan {
  const entries = entryMatchNumbers(structure);
  if (!structure || entries.size === 0) {
    throw invalid('Spots can only be changed in elimination brackets.');
  }

  const state = new Map<string, SlotEditMatch>(matches.map((m) => [m.id, { ...m }]));
  const resolve = (ref: SlotRef): SlotEditMatch => {
    const m = state.get(ref.matchId);
    if (!m) throw conflict('That match is not in this bracket any more. Refresh and try again.');
    if (!entries.has(m.matchNumber)) {
      throw invalid('Only first-round spots can be changed. Later spots fill in from results.');
    }
    if (!isSlotEditableMatch(m)) {
      throw conflict(
        `Match ${m.matchNumber} has already ${m.status === 'in_progress' ? 'started' : 'been played'}, so its spots can't change.`,
        'Undo that result first, then move people.',
      );
    }
    return m;
  };

  const person = edit.registrationId;
  const touched = new Set<string>();
  const set = (m: SlotEditMatch, slot: SlotNumber, value: string | null) => {
    m[field(slot)] = value;
    touched.add(m.id);
  };

  if (edit.action === 'move' || edit.action === 'remove') {
    const from = resolve(edit.from);
    if (from[field(edit.from.slot)] !== person) {
      throw conflict('That spot changed since you opened the bracket. Refresh and try again.');
    }
    if (edit.action === 'remove') {
      set(from, edit.from.slot, null);
    } else {
      const to = resolve(edit.to);
      if (to.id === from.id && edit.to.slot === edit.from.slot) {
        throw invalid('Pick a different spot.');
      }
      const occupant = to[field(edit.to.slot)];
      set(to, edit.to.slot, person);
      set(from, edit.from.slot, occupant);
    }
  } else {
    if (!divisionRegistrationIds.has(person)) {
      throw invalid('That person is not in this division.');
    }
    const inBracket = [...state.values()].some((m) => m.competitor1Id === person || m.competitor2Id === person);
    if (inBracket) throw conflict('That person is already in the bracket. Refresh and try again.');
    const to = resolve(edit.to);
    if (to[field(edit.to.slot)]) {
      throw conflict('That spot is taken. Pick an empty spot, or move that person first.');
    }
    set(to, edit.to.slot, person);
  }

  const before = new Map(matches.map((m) => [m.id, snapshot(m)]));
  const entryWrites = new Map<string, SlotUpdate>();
  for (const id of touched) {
    const m = state.get(id)!;
    const prev = before.get(id)!;
    if (m.competitor1Id === prev.competitor1Id && m.competitor2Id === prev.competitor2Id) continue;
    // The match has not been played (checked above), so any status it
    // holds came from the old draw. Reopen it; the sync below re-decides
    // it as ready or as an automatic BYE.
    const data: SlotUpdate['data'] = {
      competitor1Id: m.competitor1Id,
      competitor2Id: m.competitor2Id,
      status: 'pending',
      winnerId: null,
      notes: null,
      score1: null,
      score2: null,
    };
    Object.assign(m, data);
    entryWrites.set(id, { id, matchNumber: m.matchNumber, bracketType: m.bracketType, data });
  }
  if (entryWrites.size === 0) throw invalid('Nothing to change.');

  const entryRows = [...state.values()].filter((m) => entries.has(m.matchNumber));
  if (!entryRows.some((m) => m.competitor1Id || m.competitor2Id)) {
    throw invalid('A bracket needs at least one person.');
  }

  let sync: EngineUpdate[];
  try {
    sync = computeBracketSync(structure, [...state.values()]);
  } catch (error) {
    if (error instanceof BracketAdvancementConflictError) {
      throw conflict(
        `This would change a later match that has already started or finished. ${error.message}`,
        'Undo that result first, then move people.',
      );
    }
    throw error;
  }

  const merged = new Map<string, SlotUpdate>(entryWrites);
  for (const u of sync) {
    const existing = merged.get(u.id);
    if (existing) Object.assign(existing.data, u.data);
    else merged.set(u.id, { ...u, data: { ...u.data } });
    Object.assign(state.get(u.id)!, u.data);
  }

  const entryChanges: SlotEditEntryChange[] = [...entryWrites.keys()].map((id) => ({
    matchId: id,
    matchNumber: state.get(id)!.matchNumber,
    before: before.get(id)!,
    after: snapshot(state.get(id)!),
  }));

  // Keep the stored draw in step with the rows. Only the competitor
  // spots of entry matches and the head count change; match numbers,
  // links and `positions` are untouched.
  const byNumber = new Map([...state.values()].map((m) => [m.matchNumber, m]));
  const redraw = (list: MatchData[] | undefined) =>
    (list ?? []).map((md) => {
      const row = byNumber.get(md.matchNumber);
      if (!entries.has(md.matchNumber) || !row) return md;
      return { ...md, competitor1Id: row.competitor1Id, competitor2Id: row.competitor2Id };
    });
  const people = new Set(entryRows.flatMap((m) => [m.competitor1Id, m.competitor2Id]).filter((c): c is string => !!c));
  const nextStructure: BracketStructure = {
    ...structure,
    winners: redraw(structure.winners),
    finals: redraw(structure.finals),
    competitorCount: people.size,
  };

  return {
    updates: [...merged.values()],
    entryChanges,
    downstream: sync.filter((u) => !entryWrites.has(u.id)),
    structure: nextStructure,
  };
}

export function parseBracketStructure(json: string | null | undefined): BracketStructure | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BracketStructure;
  } catch {
    return null;
  }
}

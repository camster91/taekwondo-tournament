// Which bracket spots a director may edit by hand (move a person, take
// them out, or put someone into an empty spot). Shared by the server
// (which enforces it) and the bracket editor (which only offers it).

import { isByeMatch } from './match-progress.js';

interface SlotStructureMatch {
  matchNumber: number;
  nextWinnerMatch?: number | null;
  nextLoserMatch?: number | null;
}

/** Minimal slice of `BracketStructure` this helper reads. */
export interface SlotStructure {
  winners?: SlotStructureMatch[];
  losers?: SlotStructureMatch[];
  finals?: SlotStructureMatch[];
  positions?: { grandFinals: number | null; reset: number | null } | null;
}

/**
 * Match numbers of the "entry" matches: the ones whose two spots are
 * filled from the draw rather than by an earlier match's result. That
 * is the first round (winners bracket, or the lone final of a
 * 2-person single-elimination bracket). Losers-bracket matches and the
 * bracket-reset match are always filled by results, so they never count.
 * Round robin / pool structures (no `finals`) have none.
 */
export function entryMatchNumbers(structure: SlotStructure | null | undefined): Set<number> {
  const result = new Set<number>();
  if (!structure || (structure.finals?.length ?? 0) === 0) return result;
  const fed = new Set<number>();
  for (const m of [...(structure.winners ?? []), ...(structure.losers ?? []), ...(structure.finals ?? [])]) {
    if (m.nextWinnerMatch != null) fed.add(m.nextWinnerMatch);
    if (m.nextLoserMatch != null) fed.add(m.nextLoserMatch);
  }
  const finals = structure.finals ?? [];
  const grandFinals = structure.positions ? structure.positions.grandFinals : finals[0]?.matchNumber ?? null;
  const reset = structure.positions ? structure.positions.reset : finals[1]?.matchNumber ?? null;
  for (const m of [...(structure.winners ?? []), ...finals]) {
    if (fed.has(m.matchNumber)) continue;
    if (reset !== null && reset !== grandFinals && m.matchNumber === reset) continue;
    result.add(m.matchNumber);
  }
  return result;
}

/**
 * A spot in an entry match can change only while that match has not
 * been played: not started, and not completed (an automatic BYE win
 * does not count as played — it is re-decided after the change).
 */
export function isSlotEditableMatch(m: {
  status: string;
  notes?: string | null;
  competitor1Id: string | null;
  competitor2Id: string | null;
}): boolean {
  if (m.status === 'in_progress') return false;
  if (m.status === 'completed' && !isByeMatch(m)) return false;
  return true;
}

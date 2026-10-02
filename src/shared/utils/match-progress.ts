// Bye matches are auto-completed when a bracket is generated or advanced
// (an empty slot means one entrant goes straight through). They are never
// fought, so progress counts ("4 of 9 matches done") leave them out.

/** The note the match-advancement engine writes on an auto-resolved bye. */
export const BYE_NOTE = 'BYE';

export interface MatchProgressLike {
  status: string;
  notes?: string | null;
  competitor1Id?: string | null;
  competitor2Id?: string | null;
}

/** A match that was auto-resolved as a BYE (never actually contested). */
export function isByeMatch(m: MatchProgressLike): boolean {
  return m.status === 'completed' && m.notes === BYE_NOTE && !(m.competitor1Id && m.competitor2Id);
}

/** Total and completed counts over the matches that are (or will be) fought. */
export function countMatchProgress(matches: readonly MatchProgressLike[]): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  for (const m of matches) {
    if (isByeMatch(m)) continue;
    total++;
    if (m.status === 'completed') completed++;
  }
  return { total, completed };
}

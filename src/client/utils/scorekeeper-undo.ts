export function latestCompletedMatchId(
  matches: Array<{ id: string; matchNumber: number; status: string }>,
): string | null {
  return matches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => b.matchNumber - a.matchNumber)[0]?.id ?? null;
}

/**
 * Shape of a single match as the post-undo helper needs it. Kept loose
 * (the divisions query returns the full ApiMatch; this helper only
 * reads `id`, `status`, and `matchNumber`).
 */
export interface UndoCursorMatch {
  id: string;
  matchNumber: number;
  status: string;
}

export interface UndoCursorDivision {
  id: string;
  bracket: { matches: UndoCursorMatch[] } | null;
}

/**
 * After an undo, the server flips the undone match back to 'ready' or
 * 'in_progress' and clears its winner. The React Query cache is refetched
 * so the fresh data is in `queryClient.getQueryData(...)`, but the
 * Scorekeeper's `currentMatchIndex` is component-local `useState` and
 * still points at the stale slot.
 *
 * Given the freshly-refetched divisions, the scorekeeper's selected
 * division, and the id of the match that was just undone, return the
 * index in the *new* ready-matches list so the scorekeeper can re-record
 * the result without hunting for it. Returns -1 when the undone match
 * is not visible in the selected division (e.g. the scorekeeper undid
 * a match from a different division) — the caller leaves
 * `currentMatchIndex` untouched in that case.
 *
 * Closes the June 2026 audit flag: "Scorekeeper stale closure on Ctrl+Z".
 */
export function findUndoneMatchIndex(
  freshDivisions: UndoCursorDivision[] | null | undefined,
  selectedDivisionId: string | null | undefined,
  undoneMatchId: string,
): number {
  if (!freshDivisions || !selectedDivisionId || !undoneMatchId) return -1;
  const division = freshDivisions.find((d) => d.id === selectedDivisionId);
  if (!division?.bracket) return -1;
  const readyMatches = division.bracket.matches
    .filter((m) => m.status === 'ready' || m.status === 'in_progress')
    .sort((a, b) => a.matchNumber - b.matchNumber);
  return readyMatches.findIndex((m) => m.id === undoneMatchId);
}

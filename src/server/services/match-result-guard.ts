import { z } from 'zod';

/**
 * Request body for `PUT /api/brackets/match/:matchId`.
 *
 * Lives outside the route so the schema and the write decision below can
 * be unit-tested without Express or a database.
 */

// Forfeit / DQ / injury results are often entered with blank scores. The
// client used to send those as "", which the digit regex rejected; treat
// a blank string as "not provided" instead.
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

// Scores must look like "5", "12", or "0" — at most 3 digits, no
// negatives, no decimals, no letters. Stops a scorekeeper from
// submitting "<script>" or 9999 by accident and lets the client assume
// the value is safe to render verbatim. `null` clears a stored score
// (used when a director corrects the winner of a completed match).
const scoreSchema = z.preprocess(
  blankToUndefined,
  z.string().regex(/^\d{1,3}$/, 'Score must be 0-999').nullable().optional(),
);

export const matchResultSchema = z.object({
  winnerId: z.string().uuid().nullable().optional(),
  score1: scoreSchema,
  score2: scoreSchema,
  status: z.enum(['pending', 'ready', 'in_progress', 'completed', 'bye']).optional(),
  // Notes are shown in the bracket detail panel and on the PDF export,
  // so we cap length to keep both renderers fast and prevent a single
  // match from bloating the PDF.
  notes: z.string().max(500, 'Notes must be 500 characters or fewer').optional(),
  // The match `updatedAt` the client rendered (or queued offline). When
  // present and no longer current, the write is rejected with 409 so a
  // stale screen or an hours-old offline replay cannot overwrite a newer
  // result.
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  // Explicit intent to change the winner of an already-completed match
  // (director correction UI). Without it such a change is a 409.
  correction: z.boolean().optional(),
});

export type MatchResultRequest = z.infer<typeof matchResultSchema>;

type MatchStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'bye';

export interface MatchResultSnapshot {
  winnerId: string | null;
  score1: string | null;
  score2: string | null;
  status: string;
  notes: string | null;
  updatedAt: Date;
}

export interface MatchResultWriteData {
  winnerId?: string | null;
  score1?: string | null;
  score2?: string | null;
  status?: MatchStatus;
  notes?: string;
}

export type MatchResultDecision =
  /** Nothing would change (e.g. an offline replay of a delivered result). */
  | { kind: 'noop' }
  | { kind: 'write'; data: MatchResultWriteData }
  /** The stored match is not what the client based its request on. */
  | { kind: 'conflict'; reason: 'stale_version' | 'already_recorded'; message: string }
  | { kind: 'invalid'; message: string };

const same = (requested: string | null | undefined, stored: string | null) =>
  requested === undefined || (requested ?? null) === stored;

/**
 * Decide what a match-result PUT may do against the stored match.
 *
 * Order matters:
 *  1. A request that would not change anything is a no-op success, even
 *     when its `expectedUpdatedAt` is old. This keeps offline replays and
 *     double-taps idempotent after the first delivery succeeded.
 *  2. A stale `expectedUpdatedAt` is a conflict.
 *  3. Changing (or clearing) the winner of a completed match needs
 *     `correction: true`; otherwise a second scorekeeper or a late replay
 *     would silently flip a recorded result.
 *  4. A request may not leave a match `completed` without a winner.
 */
export function decideMatchResultWrite(
  current: MatchResultSnapshot,
  request: MatchResultRequest,
): MatchResultDecision {
  const { winnerId, score1, score2, status, notes, expectedUpdatedAt, correction } = request;

  const unchanged = same(winnerId, current.winnerId)
    && same(score1, current.score1)
    && same(score2, current.score2)
    && (status === undefined || status === current.status)
    && same(notes, current.notes);
  if (unchanged) return { kind: 'noop' };

  if (expectedUpdatedAt !== undefined) {
    const expected = new Date(expectedUpdatedAt).getTime();
    if (expected !== current.updatedAt.getTime()) {
      return {
        kind: 'conflict',
        reason: 'stale_version',
        message: 'This match was updated after you loaded it. Refresh to see the latest result before submitting again.',
      };
    }
  }

  const winnerChanges = winnerId !== undefined && winnerId !== current.winnerId;
  if (current.status === 'completed' && winnerChanges && correction !== true) {
    return {
      kind: 'conflict',
      reason: 'already_recorded',
      message: 'This match was already recorded with a different winner. Refresh to see the recorded result; a director can correct it from the bracket editor.',
    };
  }

  const finalStatus = status ?? current.status;
  const finalWinner = winnerId !== undefined ? winnerId : current.winnerId;
  if (finalStatus === 'completed' && !finalWinner) {
    return {
      kind: 'invalid',
      message: 'A completed match needs a winner. To clear the winner, also set status to pending or in_progress.',
    };
  }

  const data: MatchResultWriteData = { winnerId, score1, score2, status, notes };
  // A winner correction without new scores would otherwise keep the old
  // scores, which now contradict the winner. Clear them instead.
  if (current.status === 'completed' && winnerChanges && score1 === undefined && score2 === undefined) {
    data.score1 = null;
    data.score2 = null;
  }
  return { kind: 'write', data };
}

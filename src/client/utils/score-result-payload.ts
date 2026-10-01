export interface ScoreSubmission {
  matchId: string;
  winnerId: string;
  score1: string;
  score2: string;
  notes: string;
  /** The match version this result was entered against (409 if it moved on). */
  expectedUpdatedAt?: string;
}

/**
 * Body for PUT /api/brackets/match/:id. Blank scores (forfeit, DQ,
 * injury) are omitted rather than sent as "", and the rendered match
 * version travels with the result so a stale screen or a late offline
 * replay cannot overwrite a newer result.
 */
export function buildScoreResultPayload(data: ScoreSubmission): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    winnerId: data.winnerId,
    status: 'completed',
    notes: data.notes,
  };
  if (data.score1.trim() !== '') payload.score1 = data.score1.trim();
  if (data.score2.trim() !== '') payload.score2 = data.score2.trim();
  if (data.expectedUpdatedAt) payload.expectedUpdatedAt = data.expectedUpdatedAt;
  return payload;
}

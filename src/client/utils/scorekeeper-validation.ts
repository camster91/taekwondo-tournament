import type { ApiMatch } from '../../shared/contracts';
import { isValidScore, SCORE_FORMAT_MESSAGE } from '../../shared/utils/score';

export type ResultType = 'win' | 'dq' | 'forfeit' | 'injury';

/**
 * Validates scorekeeper result submission before showing confirmation dialog.
 * Prevents invalid results from reaching the server.
 * 
 * Rules:
 * - Win: requires valid non-tied scores, winner must match higher score
 * - Forfeit/Injury/DQ: winner selection required, scores optional
 * - All: both competitors must be assigned
 */
export function validateResult(
  resultType: ResultType,
  selectedWinner: string | null,
  match: ApiMatch | undefined,
  score1: string,
  score2: string,
): string | null {
  // Must have a match and winner selected
  if (!match) return 'No match selected.';
  if (!selectedWinner) return 'Select a winner before recording the result.';
  
  // Both competitors must be assigned
  if (!match.competitor1 || !match.competitor2) {
    return 'This match has an empty slot. Assign both competitors before scoring.';
  }
  
  // Winner must be one of the two competitors
  if (selectedWinner !== match.competitor1.id && selectedWinner !== match.competitor2.id) {
    return 'Selected winner is not a competitor in this match.';
  }

  // Win-specific validation: scores must be valid and non-tied
  if (resultType === 'win') {
    if (!score1.trim() || !score2.trim()) {
      return 'Enter scores for both competitors when recording a win.';
    }
    
    if (!isValidScore(score1) || !isValidScore(score2)) {
      return SCORE_FORMAT_MESSAGE;
    }

    const first = Number(score1);
    const second = Number(score2);

    if (first === second) {
      return 'A win cannot end in a tie. Enter non-tied scores or choose Forfeit/Injury/DQ.';
    }

    const scoreWinnerId = first > second ? match.competitor1.id : match.competitor2.id;
    if (scoreWinnerId !== selectedWinner) {
      return 'The winner must have the higher score. Check your scores or winner selection.';
    }
  }
  
  // Forfeit/Injury/DQ: winner required, scores optional (no validation)
  
  return null; // Valid
}

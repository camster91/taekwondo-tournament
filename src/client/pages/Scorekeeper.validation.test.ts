import { describe, it, expect } from 'vitest';

/**
 * Test suite for scorekeeper result validation (#188).
 * 
 * These tests verify that:
 * - Win requires valid non-tied scores
 * - Winner selection is always required
 * - Forfeit/Injury/DQ don't require scores
 * - Tie scores are rejected for wins
 * - Field-level validation messages are clear
 */

type ResultType = 'win' | 'dq' | 'forfeit' | 'injury';

interface Match {
  id: string;
  competitor1: { id: string; competitor: { firstName: string; lastName: string } } | null;
  competitor2: { id: string; competitor: { firstName: string; lastName: string } } | null;
}

/**
 * Validates scorekeeper result submission before showing confirmation dialog.
 * Copy of the function from Scorekeeper.tsx for isolated testing.
 */
function validateResult(
  resultType: ResultType,
  selectedWinner: string | null,
  match: Match | undefined,
  score1: string,
  score2: string,
): string | null {
  if (!match) return 'No match selected.';
  if (!selectedWinner) return 'Select a winner before recording the result.';
  
  if (!match.competitor1 || !match.competitor2) {
    return 'This match has an empty slot. Assign both competitors before scoring.';
  }
  
  if (selectedWinner !== match.competitor1.id && selectedWinner !== match.competitor2.id) {
    return 'Selected winner is not a competitor in this match.';
  }

  if (resultType === 'win') {
    if (!score1.trim() || !score2.trim()) {
      return 'Enter scores for both competitors when recording a win.';
    }
    
    const first = Number(score1);
    const second = Number(score2);
    
    if (
      !/^\d{1,3}$/.test(score1) ||
      !/^\d{1,3}$/.test(score2) ||
      !Number.isInteger(first) ||
      !Number.isInteger(second)
    ) {
      return 'Scores must be whole numbers from 0 to 999.';
    }
    
    if (first === second) {
      return 'A win cannot end in a tie. Enter non-tied scores or choose Forfeit/Injury/DQ.';
    }

    const scoreWinnerId = first > second ? match.competitor1.id : match.competitor2.id;
    if (scoreWinnerId !== selectedWinner) {
      return 'The winner must have the higher score. Check your scores or winner selection.';
    }
  }
  
  return null;
}

describe('Scorekeeper validation (#188)', () => {
  const mockMatch: Match = {
    id: 'match-1',
    competitor1: { id: 'comp-1', competitor: { firstName: 'Alice', lastName: 'Smith' } },
    competitor2: { id: 'comp-2', competitor: { firstName: 'Bob', lastName: 'Jones' } },
  };

  describe('Win result type', () => {
    it('accepts valid win with non-tied scores and correct winner', () => {
      expect(validateResult('win', 'comp-1', mockMatch, '10', '5')).toBeNull();
      expect(validateResult('win', 'comp-2', mockMatch, '3', '7')).toBeNull();
    });

    it('rejects win with tied scores', () => {
      const error = validateResult('win', 'comp-1', mockMatch, '5', '5');
      expect(error).toBe('A win cannot end in a tie. Enter non-tied scores or choose Forfeit/Injury/DQ.');
    });

    it('rejects win with missing scores', () => {
      expect(validateResult('win', 'comp-1', mockMatch, '', '')).toBe(
        'Enter scores for both competitors when recording a win.'
      );
      expect(validateResult('win', 'comp-1', mockMatch, '10', '')).toBe(
        'Enter scores for both competitors when recording a win.'
      );
      expect(validateResult('win', 'comp-1', mockMatch, '', '5')).toBe(
        'Enter scores for both competitors when recording a win.'
      );
    });

    it('rejects win when winner has lower score', () => {
      const error = validateResult('win', 'comp-1', mockMatch, '3', '10');
      expect(error).toBe('The winner must have the higher score. Check your scores or winner selection.');
    });

    it('rejects win with invalid score format', () => {
      expect(validateResult('win', 'comp-1', mockMatch, 'abc', '5')).toBe(
        'Scores must be whole numbers from 0 to 999.'
      );
      expect(validateResult('win', 'comp-1', mockMatch, '10', '5.5')).toBe(
        'Scores must be whole numbers from 0 to 999.'
      );
      expect(validateResult('win', 'comp-1', mockMatch, '-5', '3')).toBe(
        'Scores must be whole numbers from 0 to 999.'
      );
      expect(validateResult('win', 'comp-1', mockMatch, '1000', '5')).toBe(
        'Scores must be whole numbers from 0 to 999.'
      );
    });

    it('accepts boundary scores (0 and 999)', () => {
      expect(validateResult('win', 'comp-1', mockMatch, '999', '0')).toBeNull();
      expect(validateResult('win', 'comp-2', mockMatch, '0', '1')).toBeNull();
    });
  });

  describe('Forfeit result type', () => {
    it('accepts forfeit with winner but no scores', () => {
      expect(validateResult('forfeit', 'comp-1', mockMatch, '', '')).toBeNull();
    });

    it('accepts forfeit with winner and optional scores', () => {
      expect(validateResult('forfeit', 'comp-1', mockMatch, '5', '0')).toBeNull();
    });

    it('rejects forfeit without winner', () => {
      expect(validateResult('forfeit', null, mockMatch, '', '')).toBe(
        'Select a winner before recording the result.'
      );
    });
  });

  describe('Injury result type', () => {
    it('accepts injury with winner but no scores', () => {
      expect(validateResult('injury', 'comp-2', mockMatch, '', '')).toBeNull();
    });

    it('accepts injury with winner and optional scores', () => {
      expect(validateResult('injury', 'comp-2', mockMatch, '10', '8')).toBeNull();
    });

    it('rejects injury without winner', () => {
      expect(validateResult('injury', null, mockMatch, '', '')).toBe(
        'Select a winner before recording the result.'
      );
    });
  });

  describe('DQ result type', () => {
    it('accepts DQ with winner but no scores', () => {
      expect(validateResult('dq', 'comp-1', mockMatch, '', '')).toBeNull();
    });

    it('accepts DQ with winner and optional scores', () => {
      expect(validateResult('dq', 'comp-1', mockMatch, '3', '2')).toBeNull();
    });

    it('rejects DQ without winner', () => {
      expect(validateResult('dq', null, mockMatch, '', '')).toBe(
        'Select a winner before recording the result.'
      );
    });
  });

  describe('Edge cases', () => {
    it('rejects when no match is provided', () => {
      expect(validateResult('win', 'comp-1', undefined, '10', '5')).toBe(
        'No match selected.'
      );
    });

    it('rejects when match has empty competitor slots', () => {
      const emptyMatch: Match = {
        id: 'match-2',
        competitor1: { id: 'comp-1', competitor: { firstName: 'Alice', lastName: 'Smith' } },
        competitor2: null,
      };
      expect(validateResult('win', 'comp-1', emptyMatch, '10', '5')).toBe(
        'This match has an empty slot. Assign both competitors before scoring.'
      );
    });

    it('rejects when selected winner is not a competitor in the match', () => {
      expect(validateResult('win', 'wrong-id', mockMatch, '10', '5')).toBe(
        'Selected winner is not a competitor in this match.'
      );
    });

    it('handles whitespace-only scores as empty', () => {
      expect(validateResult('win', 'comp-1', mockMatch, '   ', '5')).toBe(
        'Enter scores for both competitors when recording a win.'
      );
    });
  });

  describe('Validation error messages', () => {
    it('provides clear field-level guidance for each error', () => {
      // Each error message should tell the user exactly what to fix
      expect(validateResult('win', null, mockMatch, '10', '5')).toContain('Select a winner');
      expect(validateResult('win', 'comp-1', mockMatch, '5', '5')).toContain('tie');
      expect(validateResult('win', 'comp-1', mockMatch, '', '')).toContain('Enter scores');
      expect(validateResult('win', 'comp-1', mockMatch, 'abc', '5')).toContain('whole numbers');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { latestCompletedMatchId } from './scorekeeper-undo.js';

describe('scorekeeper undo selection', () => {
  it('selects the highest-numbered completed match from the full division', () => {
    expect(latestCompletedMatchId([
      { id: 'ready', matchNumber: 9, status: 'ready' },
      { id: 'completed-2', matchNumber: 2, status: 'completed' },
      { id: 'completed-7', matchNumber: 7, status: 'completed' },
    ])).toBe('completed-7');
  });

  it('returns null when the division has no completed result', () => {
    expect(latestCompletedMatchId([{ id: 'ready', matchNumber: 1, status: 'ready' }])).toBeNull();
  });
});

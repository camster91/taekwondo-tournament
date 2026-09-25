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

  it('skips bye advancements, which have no scorekeeper result to undo', () => {
    const athlete = { id: 'registration' };
    expect(latestCompletedMatchId([
      { id: 'scored-3', matchNumber: 3, status: 'completed', competitor1: athlete, competitor2: athlete },
      { id: 'bye-7', matchNumber: 7, status: 'completed', competitor1: athlete, competitor2: null },
      { id: 'empty-14', matchNumber: 14, status: 'completed', competitor1: null, competitor2: null },
    ])).toBe('scored-3');
  });

  it('prefers the result this station just recorded while it is still completed', () => {
    const matches = [
      { id: 'winners-6', matchNumber: 6, status: 'completed' },
      { id: 'losers-8', matchNumber: 8, status: 'completed' },
    ];
    expect(latestCompletedMatchId(matches, 'winners-6')).toBe('winners-6');
    expect(latestCompletedMatchId(matches, 'undone-elsewhere')).toBe('losers-8');
  });

  it('returns null when the division has no completed result', () => {
    expect(latestCompletedMatchId([{ id: 'ready', matchNumber: 1, status: 'ready' }])).toBeNull();
  });
});

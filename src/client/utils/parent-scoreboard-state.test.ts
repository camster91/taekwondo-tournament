import { describe, expect, it } from 'vitest';
import { resolveParentScoreboardState } from './parent-scoreboard-state.js';

describe('parent scoreboard state precedence', () => {
  it('never renders match emptiness when tournament metadata failed', () => {
    expect(resolveParentScoreboardState({ tournamentLoading: false, tournamentError: true, tournamentReady: false, scoreboardLoading: false, scoreboardError: false }))
      .toBe('tournament-unavailable');
  });

  it('orders initial loading, scoreboard failure, then ready content', () => {
    expect(resolveParentScoreboardState({ tournamentLoading: true, tournamentError: false, tournamentReady: false, scoreboardLoading: false, scoreboardError: false })).toBe('loading-tournament');
    expect(resolveParentScoreboardState({ tournamentLoading: false, tournamentError: false, tournamentReady: true, scoreboardLoading: false, scoreboardError: true })).toBe('scoreboard-unavailable');
    expect(resolveParentScoreboardState({ tournamentLoading: false, tournamentError: false, tournamentReady: true, scoreboardLoading: false, scoreboardError: false })).toBe('ready');
  });
});

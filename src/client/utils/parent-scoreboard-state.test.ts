import { describe, expect, it } from 'vitest';
import { resolveParentScoreboardState } from './parent-scoreboard-state.js';

describe('parent scoreboard state precedence', () => {
  it('never renders match emptiness when tournament metadata failed', () => {
    expect(resolveParentScoreboardState({ tournamentLoading: false, tournamentError: true, tournamentReady: false, scoreboardLoading: false, scoreboardError: null, scoreboardReady: false }))
      .toBe('tournament-unavailable');
  });

  it('orders initial loading, scoreboard failure, then ready content', () => {
    expect(resolveParentScoreboardState({ tournamentLoading: true, tournamentError: false, tournamentReady: false, scoreboardLoading: false, scoreboardError: null, scoreboardReady: false })).toBe('loading-tournament');
    expect(resolveParentScoreboardState({ tournamentLoading: false, tournamentError: false, tournamentReady: true, scoreboardLoading: false, scoreboardError: new Error('offline'), scoreboardReady: false })).toBe('scoreboard-unavailable');
    expect(resolveParentScoreboardState({ tournamentLoading: false, tournamentError: false, tournamentReady: true, scoreboardLoading: false, scoreboardError: null, scoreboardReady: true })).toBe('ready');
  });

  it('keeps confirmed match data visible through a transient polling failure', () => {
    expect(resolveParentScoreboardState({
      tournamentLoading: false,
      tournamentError: false,
      tournamentReady: true,
      scoreboardLoading: false,
      scoreboardError: new TypeError('network unavailable'),
      scoreboardReady: true,
    })).toBe('stale-scoreboard');
  });

  it('fails closed when a previously loaded scoreboard link is revoked', async () => {
    const { ApiFailure } = await import('./api-status.js');
    expect(resolveParentScoreboardState({
      tournamentLoading: false,
      tournamentError: false,
      tournamentReady: true,
      scoreboardLoading: false,
      scoreboardError: new ApiFailure('inactive', 'not_found', false, 404),
      scoreboardReady: true,
    })).toBe('scoreboard-unavailable');
  });

  it('keeps confirmed matches visible through a transient metadata poll failure', () => {
    expect(resolveParentScoreboardState({
      tournamentLoading: false,
      tournamentError: new TypeError('metadata network unavailable'),
      tournamentReady: true,
      scoreboardLoading: false,
      scoreboardError: null,
      scoreboardReady: true,
    })).toBe('stale-scoreboard');
  });

  it.each(['not_found', 'forbidden', 'unauthenticated'] as const)('fails closed for cached %s metadata failures', async (kind) => {
    const { ApiFailure } = await import('./api-status.js');
    expect(resolveParentScoreboardState({
      tournamentLoading: false,
      tournamentError: new ApiFailure('access withdrawn', kind, false),
      tournamentReady: true,
      scoreboardLoading: false,
      scoreboardError: null,
      scoreboardReady: true,
    })).toBe('tournament-unavailable');
  });

  it.each(['not_found', 'forbidden', 'unauthenticated'] as const)('lets a cached %s scoreboard failure override a simultaneous transient metadata error', async (kind) => {
    const { ApiFailure } = await import('./api-status.js');
    expect(resolveParentScoreboardState({
      tournamentLoading: false,
      tournamentError: new TypeError('temporary metadata outage'),
      tournamentReady: true,
      scoreboardLoading: false,
      scoreboardError: new ApiFailure('access withdrawn', kind, false),
      scoreboardReady: true,
    })).toBe('scoreboard-unavailable');
  });
});

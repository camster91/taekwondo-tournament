import { getApiFailure } from './api-status';

export type ParentScoreboardState = 'loading-tournament' | 'tournament-unavailable' | 'loading-scoreboard' | 'scoreboard-unavailable' | 'stale-scoreboard' | 'ready';

function accessWasWithdrawn(error: unknown): boolean {
  const kind = getApiFailure(error)?.kind;
  return kind === 'not_found' || kind === 'forbidden' || kind === 'unauthenticated';
}

export function resolveParentScoreboardState(input: {
  tournamentLoading: boolean;
  tournamentError: unknown;
  tournamentReady: boolean;
  scoreboardLoading: boolean;
  scoreboardError: unknown;
  scoreboardReady: boolean;
}): ParentScoreboardState {
  if (input.tournamentLoading) return 'loading-tournament';
  if (input.scoreboardError && accessWasWithdrawn(input.scoreboardError)) return 'scoreboard-unavailable';
  if (input.tournamentError && accessWasWithdrawn(input.tournamentError)) return 'tournament-unavailable';
  if (input.tournamentError) {
    if (input.tournamentReady && input.scoreboardReady) return 'stale-scoreboard';
    return 'tournament-unavailable';
  }
  if (!input.tournamentReady) return 'tournament-unavailable';
  if (input.scoreboardLoading) return 'loading-scoreboard';
  if (input.scoreboardError) {
    return input.scoreboardReady ? 'stale-scoreboard' : 'scoreboard-unavailable';
  }
  return 'ready';
}

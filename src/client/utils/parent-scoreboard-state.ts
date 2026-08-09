export type ParentScoreboardState = 'loading-tournament' | 'tournament-unavailable' | 'loading-scoreboard' | 'scoreboard-unavailable' | 'ready';

export function resolveParentScoreboardState(input: {
  tournamentLoading: boolean;
  tournamentError: boolean;
  tournamentReady: boolean;
  scoreboardLoading: boolean;
  scoreboardError: boolean;
}): ParentScoreboardState {
  if (input.tournamentLoading) return 'loading-tournament';
  if (input.tournamentError || !input.tournamentReady) return 'tournament-unavailable';
  if (input.scoreboardLoading) return 'loading-scoreboard';
  if (input.scoreboardError) return 'scoreboard-unavailable';
  return 'ready';
}

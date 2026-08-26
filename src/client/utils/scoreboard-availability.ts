import { getApiFailure } from './api-status';

export function getScoreboardUnavailableMessage(error: unknown): string | null {
  if (!error) return null;
  const failure = getApiFailure(error);
  if (failure?.kind === 'not_found') {
    return 'This scoreboard link is inactive. Ask the tournament director for the current link.';
  }
  if (failure?.kind === 'rate_limited') {
    return failure.retryAfterSeconds
      ? `The scoreboard is receiving heavy traffic. Try again in ${failure.retryAfterSeconds} seconds.`
      : 'The scoreboard is receiving heavy traffic. Please try again shortly.';
  }
  return 'Live match data is unavailable right now. Please try again shortly.';
}

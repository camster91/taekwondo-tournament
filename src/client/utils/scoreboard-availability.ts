export function getScoreboardUnavailableMessage(error: unknown): string | null {
  return error
    ? 'Live match data is unavailable right now. Please try again shortly.'
    : null;
}

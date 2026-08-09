export function latestCompletedMatchId(
  matches: Array<{ id: string; matchNumber: number; status: string }>,
): string | null {
  return matches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => b.matchNumber - a.matchNumber)[0]?.id ?? null;
}

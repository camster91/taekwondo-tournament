import { countMatchProgress, type MatchProgressLike } from '../../shared/utils/match-progress';

type ResultsMatch = MatchProgressLike;

interface ResultsBracket {
  status?: string;
  matches?: ResultsMatch[];
}

interface ResultsDivision {
  bracket?: ResultsBracket | null;
}

export function calculateResultsStats(divisions: ResultsDivision[]) {
  const visibleDivisions = divisions.filter((division) =>
    division.bracket?.matches?.some((match) => match.status === 'completed')
  );

  return {
    totalDivisions: visibleDivisions.length,
    completedDivisions: visibleDivisions.filter(
      (division) => division.bracket?.status === 'completed'
    ).length,
    // Byes are never fought, so they aren't counted as matches.
    totalMatches: divisions.reduce(
      (sum, division) => sum + countMatchProgress(division.bracket?.matches ?? []).total,
      0
    ),
  };
}

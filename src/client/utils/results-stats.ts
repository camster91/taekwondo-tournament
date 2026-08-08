interface ResultsMatch {
  status: string;
}

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
    totalMatches: divisions.reduce(
      (sum, division) => sum + (division.bracket?.matches?.length ?? 0),
      0
    ),
  };
}

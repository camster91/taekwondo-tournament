import { describe, expect, it } from 'vitest';
import { calculateResultsStats } from './results-stats.js';

describe('calculateResultsStats', () => {
  it('counts every bracket match even when a division has no completed matches', () => {
    const divisions = [
      {
        bracket: {
          status: 'in_progress',
          matches: Array.from({ length: 14 }, (_, index) => ({
            id: `women-${index}`,
            status: 'pending',
          })),
        },
      },
      {
        bracket: {
          status: 'in_progress',
          matches: Array.from({ length: 14 }, (_, index) => ({
            id: `men-${index}`,
            status: index < 6 ? 'completed' : 'pending',
          })),
        },
      },
      {
        bracket: {
          status: 'in_progress',
          matches: Array.from({ length: 3 }, (_, index) => ({
            id: `patterns-${index}`,
            status: index === 0 ? 'completed' : 'pending',
          })),
        },
      },
    ];

    expect(calculateResultsStats(divisions)).toEqual({
      totalDivisions: 2,
      completedDivisions: 0,
      totalMatches: 31,
    });
  });
});

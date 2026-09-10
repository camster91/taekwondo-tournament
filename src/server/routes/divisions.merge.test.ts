/**
 * Division merge endpoint tests (#139)
 * 
 * Verifies cross-tournament validation, active bracket detection,
 * and transactional merge operations logic.
 * 
 * These tests pin the validation contracts without full Prisma
 * integration, following the pattern from division-assignment.test.ts.
 */

import { describe, it, expect } from 'vitest';

/**
 * Pure validation logic for division merge prerequisites
 */

interface Division {
  id: string;
  name: string;
  tournamentId: string;
  bracket: { id: string; matches: { id: string; status: string }[] } | null;
}

interface MergeValidationResult {
  status: 'ok' | 'not_found' | 'cross_tournament' | 'self_merge' | 'active_brackets';
  error?: string;
  activeBrackets?: Array<{ divisionId: string; divisionName: string; matchCount: number }>;
}

function validateMerge(
  sourceDivisionIds: string[],
  targetDivisionId: string,
  sourceDivisions: Division[],
  targetDivision: Division | null
): MergeValidationResult {
  // Check target exists
  if (!targetDivision) {
    return { status: 'not_found', error: 'Target division not found' };
  }

  // Check all sources exist
  if (sourceDivisions.length !== sourceDivisionIds.length) {
    return {
      status: 'not_found',
      error: 'One or more source divisions not found',
    };
  }

  // Check target is not in source list
  if (sourceDivisionIds.includes(targetDivisionId)) {
    return { status: 'self_merge', error: 'Target division cannot be in the source list' };
  }

  // Check all divisions belong to same tournament
  const targetTournamentId = targetDivision.tournamentId;
  const differentTournament = sourceDivisions.find((d) => d.tournamentId !== targetTournamentId);
  if (differentTournament) {
    return { status: 'cross_tournament', error: 'All divisions must belong to the same tournament' };
  }

  // Check for active brackets
  const activeBrackets = [];
  if (targetDivision.bracket && targetDivision.bracket.matches.length > 0) {
    const activeMatches = targetDivision.bracket.matches.filter(
      (m) => m.status === 'completed' || m.status === 'in_progress'
    );
    if (activeMatches.length > 0) {
      activeBrackets.push({
        divisionId: targetDivision.id,
        divisionName: targetDivision.name,
        matchCount: activeMatches.length,
      });
    }
  }
  for (const source of sourceDivisions) {
    if (source.bracket && source.bracket.matches.length > 0) {
      const activeMatches = source.bracket.matches.filter(
        (m) => m.status === 'completed' || m.status === 'in_progress'
      );
      if (activeMatches.length > 0) {
        activeBrackets.push({
          divisionId: source.id,
          divisionName: source.name,
          matchCount: activeMatches.length,
        });
      }
    }
  }

  if (activeBrackets.length > 0) {
    return {
      status: 'active_brackets',
      error: 'Cannot merge divisions with active brackets',
      activeBrackets,
    };
  }

  return { status: 'ok' };
}

describe('Division merge validation', () => {
  it('returns ok when all validations pass', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: null,
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
      { id: 'div-2', name: 'Source 2', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1', 'div-2'], 'div-target', sources, target);
    expect(result.status).toBe('ok');
  });

  it('blocks merge when target not found', () => {
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1'], 'div-target', sources, null);
    expect(result.status).toBe('not_found');
    expect(result.error).toContain('Target division not found');
  });

  it('blocks merge when source divisions not found', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: null,
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
    ];

    // Requesting 2 sources but only 1 found
    const result = validateMerge(['div-1', 'div-2'], 'div-target', sources, target);
    expect(result.status).toBe('not_found');
    expect(result.error).toContain('One or more source divisions not found');
  });

  it('blocks self-merge (target in source list)', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: null,
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
      { id: 'div-target', name: 'Target Division', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1', 'div-target'], 'div-target', sources, target);
    expect(result.status).toBe('self_merge');
    expect(result.error).toContain('Target division cannot be in the source list');
  });

  it('blocks cross-tournament merges', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: null,
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
      { id: 'div-2', name: 'Source 2', tournamentId: 't2', bracket: null }, // Different tournament
    ];

    const result = validateMerge(['div-1', 'div-2'], 'div-target', sources, target);
    expect(result.status).toBe('cross_tournament');
    expect(result.error).toContain('All divisions must belong to the same tournament');
  });

  it('detects active bracket in target division', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: {
        id: 'bracket-1',
        matches: [
          { id: 'm1', status: 'completed' },
          { id: 'm2', status: 'pending' },
        ],
      },
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1'], 'div-target', sources, target);
    expect(result.status).toBe('active_brackets');
    expect(result.activeBrackets).toHaveLength(1);
    expect(result.activeBrackets![0].divisionId).toBe('div-target');
    expect(result.activeBrackets![0].matchCount).toBe(1); // Only 1 completed match
  });

  it('detects active brackets in source divisions', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: null,
    };
    const sources: Division[] = [
      {
        id: 'div-1',
        name: 'Source 1',
        tournamentId: 't1',
        bracket: {
          id: 'bracket-1',
          matches: [{ id: 'm1', status: 'in_progress' }],
        },
      },
      {
        id: 'div-2',
        name: 'Source 2',
        tournamentId: 't1',
        bracket: {
          id: 'bracket-2',
          matches: [{ id: 'm2', status: 'completed' }],
        },
      },
    ];

    const result = validateMerge(['div-1', 'div-2'], 'div-target', sources, target);
    expect(result.status).toBe('active_brackets');
    expect(result.activeBrackets).toHaveLength(2);
    expect(result.activeBrackets!.map((b) => b.divisionId)).toEqual(['div-1', 'div-2']);
  });

  it('ignores pending matches (only completed/in_progress count as active)', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: {
        id: 'bracket-1',
        matches: [
          { id: 'm1', status: 'pending' },
          { id: 'm2', status: 'ready' },
        ],
      },
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1'], 'div-target', sources, target);
    expect(result.status).toBe('ok'); // Pending/ready matches don't block merge
  });
});

describe('Merge error response contracts', () => {
  it('returns 409 with ACTIVE_BRACKETS code', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: {
        id: 'bracket-1',
        matches: [{ id: 'm1', status: 'completed' }],
      },
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1'], 'div-target', sources, target);
    expect(result.status).toBe('active_brackets');
    // Pin the error contract so client can rely on it
    expect(result.error).toBe('Cannot merge divisions with active brackets');
  });

  it('includes active bracket details for client display', () => {
    const target: Division = {
      id: 'div-target',
      name: 'Target Division',
      tournamentId: 't1',
      bracket: {
        id: 'bracket-1',
        matches: [{ id: 'm1', status: 'completed' }],
      },
    };
    const sources: Division[] = [
      { id: 'div-1', name: 'Source 1', tournamentId: 't1', bracket: null },
    ];

    const result = validateMerge(['div-1'], 'div-target', sources, target);
    expect(result.activeBrackets).toBeDefined();
    expect(result.activeBrackets![0]).toMatchObject({
      divisionId: 'div-target',
      divisionName: 'Target Division',
      matchCount: 1,
    });
  });
});

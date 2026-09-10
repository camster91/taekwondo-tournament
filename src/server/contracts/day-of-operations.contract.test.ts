/**
 * Day-of operations contract tests.
 * 
 * Verifies that GET /api/tournaments/:id/day-of returns the shape expected
 * by the director dashboard live control room.
 */

import { describe, it, expect } from 'vitest';
import {
  dayOfOperationsResponseSchema,
  ringStatusSchema,
  divisionProgressSchema,
  dayOfWarningSchema,
} from '../../shared/contracts/index.js';

describe('Day-of Operations Contract', () => {
  it('validates a complete day-of response', () => {
    const response = {
      divisions: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'BB Males Sparring Heavy',
          eventType: 'sparring',
          beltLevel: 'BB',
          gender: 'M',
          ageMin: 18,
          ageMax: 35,
          weightClass: 'Heavy',
          displayOrder: 1,
          bracket: {
            id: '123e4567-e89b-12d3-a456-426614174001',
            format: 'double_elim',
            matches: [
              {
                id: '123e4567-e89b-12d3-a456-426614174002',
                matchNumber: 1,
                roundNumber: 1,
                bracketType: 'winners',
                status: 'completed',
                ringNumber: 1,
                competitor1: {
                  id: '123e4567-e89b-12d3-a456-426614174003',
                  competitor: {
                    firstName: 'John',
                    lastName: 'Doe',
                    schoolDojang: 'Test Dojang',
                  },
                },
                competitor2: {
                  id: '123e4567-e89b-12d3-a456-426614174004',
                  competitor: {
                    firstName: 'Jane',
                    lastName: 'Smith',
                    schoolDojang: 'Test Dojang',
                  },
                },
                winner: {
                  id: '123e4567-e89b-12d3-a456-426614174003',
                  competitor: {
                    firstName: 'John',
                    lastName: 'Doe',
                    schoolDojang: 'Test Dojang',
                  },
                },
                score1: '12',
                score2: '8',
                startedAt: '2026-12-01T10:00:00Z',
                updatedAt: '2026-12-01T10:05:00Z',
              },
            ],
          },
        },
      ],
      ringStatus: [
        {
          ringNumber: 1,
          currentMatchId: '123e4567-e89b-12d3-a456-426614174002',
          currentDivisionId: '123e4567-e89b-12d3-a456-426614174000',
          currentDivisionName: 'BB Males Sparring Heavy',
          status: 'active',
          matchesCompleted: 5,
          matchesRemaining: 10,
          estimatedCompletionMs: 1800000, // 30 minutes
        },
      ],
      divisionProgress: [
        {
          divisionId: '123e4567-e89b-12d3-a456-426614174000',
          divisionName: 'BB Males Sparring Heavy',
          totalMatches: 15,
          completedMatches: 5,
          inProgressMatches: 1,
          pendingMatches: 9,
          percentComplete: 33.33,
          assignedRing: 1,
          isComplete: false,
        },
      ],
      warnings: [
        {
          id: 'warn-1',
          severity: 'warning',
          category: 'ring',
          message: 'Ring 1 running 15 minutes behind schedule',
          divisionId: null,
          ringNumber: 1,
          timestamp: '2026-12-01T10:30:00Z',
        },
      ],
      tournamentStatus: 'in_progress',
      totalMatches: 15,
      completedMatches: 5,
      activeRings: 1,
    };

    expect(() => dayOfOperationsResponseSchema.parse(response)).not.toThrow();
  });

  it('validates ring status shape', () => {
    const ringStatus = {
      ringNumber: 2,
      currentMatchId: null,
      currentDivisionId: null,
      currentDivisionName: null,
      status: 'idle',
      matchesCompleted: 0,
      matchesRemaining: 0,
      estimatedCompletionMs: null,
    };

    expect(() => ringStatusSchema.parse(ringStatus)).not.toThrow();
  });

  it('validates division progress shape', () => {
    const progress = {
      divisionId: '123e4567-e89b-12d3-a456-426614174000',
      divisionName: 'Test Division',
      totalMatches: 10,
      completedMatches: 10,
      inProgressMatches: 0,
      pendingMatches: 0,
      percentComplete: 100,
      assignedRing: null,
      isComplete: true,
    };

    expect(() => divisionProgressSchema.parse(progress)).not.toThrow();
  });

  it('validates day-of warning shape', () => {
    const warning = {
      id: 'warn-critical-1',
      severity: 'critical',
      category: 'ring', // Use valid category from enum
      message: 'Injury reported in Ring 3',
      divisionId: '123e4567-e89b-12d3-a456-426614174000',
      ringNumber: 3,
      timestamp: '2026-12-01T11:00:00Z',
    };

    expect(() => dayOfWarningSchema.parse(warning)).not.toThrow();
  });

  it('rejects invalid ring status enum values', () => {
    const invalidStatus = {
      ringNumber: 1,
      currentMatchId: null,
      currentDivisionId: null,
      currentDivisionName: null,
      status: 'broken', // <-- not in enum
      matchesCompleted: 0,
      matchesRemaining: 0,
      estimatedCompletionMs: null,
    };

    expect(() => ringStatusSchema.parse(invalidStatus)).toThrow(/status/);
  });

  it('rejects invalid warning severity values', () => {
    const invalidWarning = {
      id: 'warn-1',
      severity: 'super-critical', // <-- not in enum
      category: 'other',
      message: 'Test',
      divisionId: null,
      ringNumber: null,
      timestamp: '2026-12-01T10:00:00Z',
    };

    expect(() => dayOfWarningSchema.parse(invalidWarning)).toThrow(/severity/);
  });

  it('validates minimal day-of response with empty arrays', () => {
    const minimal = {
      divisions: [],
      ringStatus: [],
      divisionProgress: [],
      warnings: [],
      tournamentStatus: 'draft',
      totalMatches: 0,
      completedMatches: 0,
      activeRings: 0,
    };

    expect(() => dayOfOperationsResponseSchema.parse(minimal)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  isSafeScheduleImprovement,
  optimizeTournamentSchedule,
  scoreTournamentSchedule,
  type ScheduleOptimizerInput,
} from './schedule-optimizer.js';

const input = (overrides: Partial<ScheduleOptimizerInput> = {}): ScheduleOptimizerInput => ({
  tournamentId: 'tournament-1',
  ringCount: 2,
  restWindowMinutes: 10,
  ringDelayMinutes: {},
  blockedRings: [],
  divisions: [
    {
      divisionId: 'patterns',
      divisionName: 'Patterns',
      durationMinutes: 20,
      currentRing: 1,
      currentStartMinutes: 540,
      eligibleRings: [1, 2],
      registrationIds: ['athlete-1'],
      conflictGroupIds: ['school-north'],
      locked: false,
    },
    {
      divisionId: 'sparring',
      divisionName: 'Sparring',
      durationMinutes: 20,
      currentRing: 2,
      currentStartMinutes: 540,
      eligibleRings: [1, 2],
      registrationIds: ['athlete-1'],
      conflictGroupIds: ['school-south'],
      locked: false,
    },
  ],
  ...overrides,
});

describe('schedule optimizer', () => {
  it('proposes a deterministic measurable improvement without overlapping an athlete rest window', () => {
    const first = optimizeTournamentSchedule(input());
    const second = optimizeTournamentSchedule(input());

    expect(first).toEqual(second);
    expect(first.before.metrics.athleteConflicts).toBe(1);
    expect(first.after.metrics.athleteConflicts).toBe(0);
    expect(first.after.metrics.totalPenalty).toBeLessThan(first.before.metrics.totalPenalty);
    expect(first.improved).toBe(true);

    const patterns = first.after.schedule.find((row) => row.divisionId === 'patterns')!;
    const sparring = first.after.schedule.find((row) => row.divisionId === 'sparring')!;
    expect(Math.abs(patterns.startMinutes - sparring.startMinutes)).toBeGreaterThanOrEqual(30);
  });

  it('preserves manual locks exactly and honors ring eligibility', () => {
    const locked = input().divisions[0];
    const result = optimizeTournamentSchedule(input({
      divisions: [
        { ...locked, locked: true, eligibleRings: [1] },
        { ...input().divisions[1], eligibleRings: [2] },
      ],
    }));

    expect(result.after.schedule).toContainEqual(expect.objectContaining({
      divisionId: locked.divisionId,
      ring: locked.currentRing,
      startMinutes: locked.currentStartMinutes,
      locked: true,
    }));
    expect(result.after.schedule.find((row) => row.divisionId === 'sparring')?.ring).toBe(2);
  });

  it('reduces known school or coach-group conflicts without pretending unknown coach data exists', () => {
    const result = optimizeTournamentSchedule(input({
      divisions: input().divisions.map((division, index) => ({
        ...division,
        registrationIds: [`athlete-${index + 1}`],
        conflictGroupIds: ['school:north-star'],
      })),
    }));

    expect(result.before.metrics.athleteConflicts).toBe(0);
    expect(result.before.metrics.conflictGroupConflicts).toBe(1);
    expect(result.after.metrics.conflictGroupConflicts).toBe(0);
    expect(result.improved).toBe(true);
  });

  it('accounts for live ring delay and unresolved incident blocks', () => {
    const result = optimizeTournamentSchedule(input({
      ringDelayMinutes: { 1: 25 },
      blockedRings: [2],
      divisions: [{
        ...input().divisions[0],
        currentRing: 1,
        currentStartMinutes: 600,
        registrationIds: [],
        conflictGroupIds: [],
      }],
    }));

    expect(result.after.schedule[0].ring).toBe(1);
    expect(result.after.schedule[0].startMinutes).toBeGreaterThanOrEqual(625);
    expect(result.constraints).toEqual(expect.arrayContaining([
      'Ring 2 is unavailable because of an unresolved incident',
      'Ring 1 is currently 25 minutes behind',
    ]));
  });

  it('does not claim improvement when every division is locked', () => {
    const lockedInput = input({
      divisions: input().divisions.map((division) => ({ ...division, locked: true })),
    });
    const result = optimizeTournamentSchedule(lockedInput);

    expect(result.improved).toBe(false);
    expect(result.after.schedule).toEqual(result.before.schedule);
    expect(scoreTournamentSchedule(result.after.schedule, lockedInput).totalPenalty)
      .toBe(result.before.metrics.totalPenalty);
  });

  it('rejects a lower weighted score when any hard safety metric regresses', () => {
    const before = {
      athleteConflicts: 0, conflictGroupConflicts: 2, ringOverlaps: 1,
      unavailableRingAssignments: 0, delayViolations: 0,
      ringLoadSpreadMinutes: 90, movedDivisions: 0, totalPenalty: 25_000,
    };
    const after = {
      ...before, athleteConflicts: 1, conflictGroupConflicts: 0,
      ringOverlaps: 0, ringLoadSpreadMinutes: 0, movedDivisions: 2,
      totalPenalty: 10_010,
    };

    expect(after.totalPenalty).toBeLessThan(before.totalPenalty);
    expect(isSafeScheduleImprovement(before, after)).toBe(false);
  });

  it('fails closed for duplicate divisions and incomplete or invalid ring coverage', () => {
    expect(() => optimizeTournamentSchedule(input({
      divisions: [input().divisions[0], input().divisions[0]],
    }))).toThrow('duplicate division');
    expect(() => optimizeTournamentSchedule(input({
      divisions: [{ ...input().divisions[0], eligibleRings: [] }],
    }))).toThrow('eligible ring');
    expect(() => optimizeTournamentSchedule(input({
      divisions: [{ ...input().divisions[0], currentRing: 3 }],
    }))).toThrow('current ring');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildScheduleOptimizationInput,
  buildScheduleOptimizationRecommendation,
  loadScheduleOptimizationInput,
  readScheduleOperationalConditions,
  scheduleOptimizationInputVersion,
  validateScheduleOptimizationSnapshot,
  SCHEDULE_OPTIMIZATION_TYPE,
  type ScheduleOptimizationRecommendationInput,
} from './schedule-optimization-recommendations.js';

const input = (overrides: Partial<ScheduleOptimizationRecommendationInput> = {}): ScheduleOptimizationRecommendationInput => ({
  tournamentId: 'tournament-1',
  optimizerInput: {
    tournamentId: 'tournament-1', ringCount: 2, restWindowMinutes: 10,
    ringDelayMinutes: {}, blockedRings: [],
    divisions: [
      {
        divisionId: 'patterns', divisionName: 'Patterns', durationMinutes: 20,
        currentRing: 1, currentStartMinutes: 540, eligibleRings: [1, 2],
        registrationIds: ['athlete-1'], conflictGroupIds: ['school:north'], locked: true,
      },
      {
        divisionId: 'sparring', divisionName: 'Sparring', durationMinutes: 20,
        currentRing: 2, currentStartMinutes: 540, eligibleRings: [1, 2],
        registrationIds: ['athlete-1'], conflictGroupIds: ['school:south'], locked: false,
      },
    ],
  },
  evidence: {
    capturedAt: '2026-08-09T14:00:00.000Z',
    athleteIdentityCoverage: { known: 2, total: 2 },
    conflictGroupCoverage: { known: 2, total: 2, coachDataAvailable: false },
    durationCoverage: { known: 2, total: 2 },
    liveDelaySources: [], incidentSources: [],
  },
  ...overrides,
});

describe('schedule optimization recommendations', () => {
  it('builds an immutable measurable before/after proposal and preserves locked rows', () => {
    const proposal = buildScheduleOptimizationRecommendation(input());

    expect(proposal.recommendationType).toBe(SCHEDULE_OPTIMIZATION_TYPE);
    expect(proposal.proposedDiff.before.metrics.athleteConflicts).toBe(1);
    expect(proposal.proposedDiff.after.metrics.athleteConflicts).toBe(0);
    expect(proposal.proposedDiff.afterCanonical.rows.find((row) => row.divisionId === 'patterns')).toEqual({
      divisionId: 'patterns', ring: 1, startMinutes: 540, durationMinutes: 20, locked: true,
    });
    expect(proposal.proposedDiff.moved).toEqual([
      expect.objectContaining({ divisionId: 'sparring', before: { ring: 2, startMinutes: 540 }, after: { ring: 1, startMinutes: 570 } }),
    ]);
    expect(proposal.explanation).toContain('known athlete/rest conflict');
    expect(proposal.warnings).toContain('Coach identity is not available; conflict groups currently use known school data only.');
  });

  it('versions canonicalized inputs independently of array order', () => {
    const first = input();
    const reversed = input({
      optimizerInput: {
        ...first.optimizerInput,
        divisions: [...first.optimizerInput.divisions].reverse().map((division) => ({
          ...division,
          eligibleRings: [...division.eligibleRings].reverse(),
          registrationIds: [...division.registrationIds].reverse(),
          conflictGroupIds: [...division.conflictGroupIds].reverse(),
        })),
      },
    });
    expect(scheduleOptimizationInputVersion(first)).toBe(scheduleOptimizationInputVersion(reversed));
  });

  it('rejects no-improvement proposals and tampered output', () => {
    const allLocked = input({
      optimizerInput: {
        ...input().optimizerInput,
        divisions: input().optimizerInput.divisions.map((division) => ({ ...division, locked: true })),
      },
    });
    expect(() => buildScheduleOptimizationRecommendation(allLocked)).toThrow('No safer measurable improvement');

    const proposal = buildScheduleOptimizationRecommendation(input());
    expect(validateScheduleOptimizationSnapshot(input(), proposal.proposedDiff)).toEqual({ valid: true, errors: [] });
    expect(validateScheduleOptimizationSnapshot(input(), {
      ...proposal.proposedDiff,
      afterCanonical: {
        ...proposal.proposedDiff.afterCanonical,
        rows: proposal.proposedDiff.afterCanonical.rows.map((row) => row.divisionId === 'patterns' ? { ...row, ring: 2 } : row),
      },
    })).toEqual({ valid: false, errors: expect.arrayContaining(['Proposed schedule output changed']) });
  });

  it('derives identities and normalized school conflict groups from server schedule records', () => {
    const built = buildScheduleOptimizationInput({
      tournamentId: 'tournament-1', ringCount: 2, capturedAt: '2026-08-09T14:00:00.000Z',
      schedule: [
        { divisionId: 'patterns', divisionName: 'Patterns', ring: 1, startTime: '09:00', estimatedDurationMinutes: 20 },
        { divisionId: 'sparring', divisionName: 'Sparring', ring: 2, startTime: '09:00', estimatedDurationMinutes: 20 },
      ],
      divisions: [
        { id: 'patterns', assignments: [{ registrationId: 'r1', schoolDojang: ' North Star ' }] },
        { id: 'sparring', assignments: [{ registrationId: 'r2', schoolDojang: 'north star' }, { registrationId: 'r3', schoolDojang: null }] },
      ],
      canonicalSchedule: { version: 1, rows: [
        { divisionId: 'patterns', ring: 1, startMinutes: 540, durationMinutes: 20, locked: true },
        { divisionId: 'sparring', ring: 2, startMinutes: 540, durationMinutes: 20, locked: false },
      ] },
      operationalConditions: { restWindowMinutes: 15, liveDelaySources: [], incidentSources: [] },
    });

    expect(built.optimizerInput.divisions[0]).toMatchObject({
      divisionId: 'patterns', registrationIds: ['r1'], conflictGroupIds: ['school:north star'], locked: true,
    });
    expect(built.optimizerInput.divisions[1].conflictGroupIds).toEqual(['school:north star']);
    expect(built.evidence.conflictGroupCoverage).toEqual({ known: 2, total: 3, coachDataAvailable: false });
    expect(built.optimizerInput.restWindowMinutes).toBe(15);
  });

  it('requires provenance for persisted delay and incident conditions', () => {
    const valid = JSON.stringify({ scheduleOperations: {
      restWindowMinutes: 10,
      liveDelaySources: [{ ring: 1, delayMinutes: 12, observedAt: '2026-08-09T14:00:00.000Z', source: 'director-confirmed' }],
      incidentSources: [{ incidentId: 'incident-1', ring: 2, observedAt: '2026-08-09T14:01:00.000Z', label: 'Medical pause' }],
    } });
    expect(readScheduleOperationalConditions(valid, 2, new Date('2026-08-09T14:05:00Z'))).toEqual({
      restWindowMinutes: 10,
      liveDelaySources: [{ ring: 1, delayMinutes: 12, observedAt: '2026-08-09T14:00:00.000Z', source: 'director-confirmed' }],
      incidentSources: [{ incidentId: 'incident-1', ring: 2, observedAt: '2026-08-09T14:01:00.000Z', label: 'Medical pause' }],
    });
    expect(() => readScheduleOperationalConditions(JSON.stringify({ scheduleOperations: {
      restWindowMinutes: 10,
      liveDelaySources: [{ ring: 1, delayMinutes: 12 }], incidentSources: [],
    } }), 2, new Date('2026-08-09T14:05:00Z'))).toThrow('provenance');
    expect(() => readScheduleOperationalConditions(JSON.stringify({ scheduleOperations: {
      restWindowMinutes: 10,
      liveDelaySources: [{ ring: 1, delayMinutes: 241, observedAt: '2026-08-09T14:00:00.000Z', source: 'director-confirmed' }], incidentSources: [],
    } }), 2, new Date('2026-08-09T14:05:00Z'))).toThrow('delay');
    expect(() => readScheduleOperationalConditions(valid, 2, new Date('2026-08-09T15:00:01Z'))).toThrow('expired');
  });

  it('loads proposal inputs from tournament-scoped records rather than client arrays', async () => {
    const database = {
      tournament: { findUnique: async () => ({ settings: null }) },
      division: { findMany: async () => [
        { id: 'patterns', assignments: [{ registrationId: 'r1', registration: { competitor: { schoolDojang: 'North Star' } } }] },
        { id: 'sparring', assignments: [{ registrationId: 'r1', registration: { competitor: { schoolDojang: 'North Star' } } }] },
      ] },
    };
    const generate = async () => ({
      tournamentId: 'tournament-1', tournamentName: 'Open', date: '2027-01-01T00:00:00.000Z',
      config: { startTime: '09:00', endTime: '17:00', ringCount: 2, matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5 },
      schedule: [
        { divisionId: 'patterns', divisionName: 'Patterns', ring: 1, startTime: '09:00', endTime: '09:20', estimatedDurationMinutes: 20, eventType: 'patterns', beltLevel: 'CB', gender: 'F', competitorCount: 1, competitorNames: ['Amina'] },
        { divisionId: 'sparring', divisionName: 'Sparring', ring: 2, startTime: '09:00', endTime: '09:20', estimatedDurationMinutes: 20, eventType: 'sparring', beltLevel: 'CB', gender: 'F', competitorCount: 1, competitorNames: ['Amina'] },
      ], warnings: [],
    });

    const loaded = await loadScheduleOptimizationInput(database as never, 'tournament-1', new Date('2026-08-09T14:00:00Z'), generate as never);

    expect(loaded.optimizerInput.divisions.map((division) => division.registrationIds)).toEqual([['r1'], ['r1']]);
    expect(loaded.evidence.capturedAt).toBe('2026-08-09T14:00:00.000Z');
  });

  it('rejects incident provenance that is not an unresolved incident in the same tournament', async () => {
    const settings = JSON.stringify({ scheduleOperations: {
      restWindowMinutes: 10, liveDelaySources: [],
      incidentSources: [{ incidentId: 'foreign-incident', ring: 1, observedAt: '2026-08-09T14:00:00.000Z', label: 'Medical pause' }],
    } });
    const database = {
      tournament: { findUnique: async () => ({ settings }) },
      division: { findMany: async () => [{ id: 'patterns', assignments: [] }] },
      incident: { findMany: async () => [] },
    };
    const generate = async () => ({
      tournamentId: 'tournament-1', tournamentName: 'Open', date: '2027-01-01T00:00:00.000Z',
      config: { startTime: '09:00', endTime: '17:00', ringCount: 1, matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5 },
      schedule: [{ divisionId: 'patterns', divisionName: 'Patterns', ring: 1, startTime: '09:00', endTime: '09:20', estimatedDurationMinutes: 20 }], warnings: [],
    });
    await expect(loadScheduleOptimizationInput(database as never, 'tournament-1', new Date('2026-08-09T14:05:00Z'), generate as never))
      .rejects.toThrow('incident provenance');
  });
});

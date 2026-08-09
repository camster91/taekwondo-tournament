import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRecommendation: vi.fn(),
  applyApprovedRecommendation: vi.fn(),
}));
vi.mock('./recommendation-contract.js', async (load) => {
  const actual = await load<typeof import('./recommendation-contract.js')>();
  return {
    ...actual,
    createRecommendation: (...args: unknown[]) => mocks.createRecommendation(...args),
    applyApprovedRecommendation: (...args: unknown[]) => mocks.applyApprovedRecommendation(...args),
  };
});

import {
  applyScheduleOptimizationRecommendation,
  createScheduleOptimizationRecommendation,
  SCHEDULE_OPTIMIZATION_TYPE,
  saveScheduleOperationalConditions,
  saveScheduleDivisionLock,
  undoScheduleOptimizationRecommendation,
} from './schedule-optimization-recommendations.js';

describe('schedule optimization recommendation lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a proposed recommendation without mutating tournament settings', async () => {
    const database = {
      tournament: { findUnique: vi.fn().mockResolvedValue({ settings: null }) },
      division: { findMany: vi.fn().mockResolvedValue([
        { id: 'a', assignments: [{ registrationId: 'r1', registration: { competitor: { schoolDojang: 'North' } } }] },
        { id: 'b', assignments: [{ registrationId: 'r1', registration: { competitor: { schoolDojang: 'North' } } }] },
      ]) },
    };
    const generate = vi.fn().mockResolvedValue({
      tournamentId: 't1', tournamentName: 'Open', date: '2027-01-01T00:00:00.000Z',
      config: { startTime: '09:00', endTime: '17:00', ringCount: 2, matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5 },
      schedule: [
        { divisionId: 'a', divisionName: 'A', ring: 1, startTime: '09:00', endTime: '09:20', estimatedDurationMinutes: 20 },
        { divisionId: 'b', divisionName: 'B', ring: 2, startTime: '09:00', endTime: '09:20', estimatedDurationMinutes: 20 },
      ], warnings: [],
    });
    mocks.createRecommendation.mockResolvedValue({ id: 'rec-1', status: 'proposed' });

    const result = await createScheduleOptimizationRecommendation(database as never, 't1', 'director-1', new Date('2026-08-09T14:00:00Z'), generate as never);

    expect(mocks.createRecommendation).toHaveBeenCalledWith(database, expect.objectContaining({
      tournamentId: 't1', recommendationType: SCHEDULE_OPTIMIZATION_TYPE, createdBy: 'director-1',
    }), expect.any(Function));
    expect(result).toEqual({ id: 'rec-1', status: 'proposed' });
    expect(database.tournament.findUnique).toHaveBeenCalledTimes(1);
  });

  it('atomically persists the exact reviewed canonical rows and returns reversible audit evidence', async () => {
    const afterCanonical = { version: 1 as const, rows: [
      { divisionId: 'a', ring: 1, startMinutes: 540, durationMinutes: 20, locked: true },
      { divisionId: 'b', ring: 1, startMinutes: 570, durationMinutes: 20, locked: false },
    ] };
    const recommendation = {
      id: 'rec-1', tournamentId: 't1', recommendationType: SCHEDULE_OPTIMIZATION_TYPE,
      inputSnapshot: JSON.stringify({}),
      proposedDiff: JSON.stringify({
        afterCanonical, moved: [{ divisionId: 'b' }],
        before: { metrics: { athleteConflicts: 1 } }, after: { metrics: { athleteConflicts: 0 } },
        resultVersion: 'result-1',
      }),
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { tournament: { findUnique: vi.fn().mockResolvedValue({ settings: '{"theme":"dark"}' }), updateMany } };
    mocks.applyApprovedRecommendation.mockImplementation(async (_db, _id, _user, apply) => apply(tx, recommendation));

    const result = await applyScheduleOptimizationRecommendation({} as never, 'rec-1', 'director-1');

    const saved = JSON.parse(updateMany.mock.calls[0][0].data.settings);
    expect(saved.theme).toBe('dark');
    expect(saved.canonicalSchedule).toEqual(afterCanonical);
    expect(result).toMatchObject({
      undoReference: 'schedule-recommendation:rec-1',
      beforeState: '{"theme":"dark"}',
      afterState: updateMany.mock.calls[0][0].data.settings,
    });
  });

  it('undoes only the exact applied settings and marks the bound audit', async () => {
    const updateTournament = vi.fn().mockResolvedValue({ count: 1 });
    const markAudit = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRawUnsafe: vi.fn(),
      recommendation: { findFirst: vi.fn().mockResolvedValue({
        id: 'rec-1', tournamentId: 't1', recommendationType: SCHEDULE_OPTIMIZATION_TYPE,
        status: 'applied', operationAuditId: 'audit-1', undoReference: 'schedule-recommendation:rec-1',
      }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      tournamentOperationAudit: { findFirst: vi.fn().mockResolvedValue({
        id: 'audit-1', tournamentId: 't1', reversible: true, undoneAt: null,
        beforeState: JSON.stringify('{"theme":"dark"}'),
        afterState: JSON.stringify('{"theme":"dark","canonicalSchedule":{"version":1,"rows":[]}}'),
      }), updateMany: markAudit },
      tournament: {
        findUnique: vi.fn().mockResolvedValue({ settings: '{"theme":"dark","canonicalSchedule":{"version":1,"rows":[]}}' }),
        updateMany: updateTournament,
      },
    };
    const database = { $transaction: (work: (client: typeof tx) => unknown) => work(tx) };

    await undoScheduleOptimizationRecommendation(database as never, 't1', 'rec-1', 'director-1');

    expect(updateTournament).toHaveBeenCalledWith({
      where: { id: 't1', settings: '{"theme":"dark","canonicalSchedule":{"version":1,"rows":[]}}' },
      data: { settings: '{"theme":"dark"}' },
    });
    expect(markAudit).toHaveBeenCalledWith({
      where: { id: 'audit-1', undoneAt: null },
      data: { undoneAt: expect.any(Date), undoneBy: 'director-1' },
    });
  });

  it('stores fresh bounded live conditions only after resolving tournament incidents', async () => {
    const update = vi.fn().mockResolvedValue({ id: 't1' });
    const tx = {
      tournament: { findUniqueOrThrow: vi.fn().mockResolvedValue({ settings: '{"theme":"dark"}' }), update },
      incident: { findMany: vi.fn().mockResolvedValue([{ id: 'incident-1', type: 'medical', severity: 'serious' }]) },
      recommendation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const database = { $transaction: (work: (client: typeof tx) => unknown) => work(tx) };

    await saveScheduleOperationalConditions(database as never, 't1', {
      restWindowMinutes: 10,
      ringDelays: [{ ring: 1, delayMinutes: 12 }],
      incidentBlocks: [{ incidentId: 'incident-1', ring: 2 }],
    }, new Date('2026-08-09T14:00:00Z'));

    const saved = JSON.parse(update.mock.calls[0][0].data.settings);
    expect(saved.theme).toBe('dark');
    expect(saved.scheduleOperations).toEqual({
      restWindowMinutes: 10,
      liveDelaySources: [{ ring: 1, delayMinutes: 12, observedAt: '2026-08-09T14:00:00.000Z', source: 'director-confirmed' }],
      incidentSources: [{ incidentId: 'incident-1', ring: 2, observedAt: '2026-08-09T14:00:00.000Z', label: 'medical (serious)' }],
    });
  });

  it('persists a server-resolved lock without accepting client timing rows', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      tournament: { findUnique: vi.fn().mockResolvedValue({ settings: '{"theme":"dark","scheduleOperations":{"restWindowMinutes":10,"liveDelaySources":[{"ring":1,"delayMinutes":12,"source":"director-confirmed","observedAt":"2020-01-01T00:00:00.000Z"}],"incidentSources":[]}}' }), updateMany },
      division: { findMany: vi.fn().mockResolvedValue([{ id: 'a', assignments: [] }]) },
      recommendation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const database = { $transaction: (work: (client: typeof tx) => unknown) => work(tx) };
    const generate = vi.fn().mockResolvedValue({
      tournamentId: 't1', tournamentName: 'Open', date: '2027-01-01T00:00:00.000Z',
      config: { startTime: '09:00', endTime: '17:00', ringCount: 2, matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5 },
      schedule: [{ divisionId: 'a', divisionName: 'A', ring: 2, startTime: '09:15', endTime: '09:35', estimatedDurationMinutes: 20 }], warnings: [],
    });

    await saveScheduleDivisionLock(database as never, 't1', 'a', true, generate as never);

    const saved = JSON.parse(updateMany.mock.calls[0][0].data.settings);
    expect(saved.theme).toBe('dark');
    expect(saved.scheduleOperations.liveDelaySources[0].observedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(saved.canonicalSchedule.rows).toEqual([{ divisionId: 'a', ring: 2, startMinutes: 555, durationMinutes: 20, locked: true }]);
    expect(updateMany.mock.calls[0][0].where.settings).toContain('2020-01-01');
  });
});

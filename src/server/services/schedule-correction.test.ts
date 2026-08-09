import { describe, expect, it, vi } from 'vitest';
import {
  buildScheduleImpact,
  mergeScheduleSettings,
  readStoredScheduleConfig,
  applyScheduleCorrection,
  undoScheduleCorrection,
  scheduleInputVersion,
  scheduleResultVersion,
} from './schedule-correction.js';

const config = {
  startTime: '09:00', endTime: '17:00', ringCount: 2,
  matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5,
};

describe('schedule correction safety', () => {
  it('reads a complete saved config and preserves unrelated tournament settings', () => {
    const settings = JSON.stringify({ registrationFee: '45', schedule: config, rules: { avoidSameSchool: true } });
    expect(readStoredScheduleConfig(settings)).toEqual(config);
    expect(JSON.parse(mergeScheduleSettings(settings, { ...config, ringCount: 4 }))).toEqual({
      registrationFee: '45', rules: { avoidSameSchool: true },
      schedule: { ...config, ringCount: 4 },
      rings: { count: 4, startTime: '09:00', endTime: '17:00' },
    });
  });

  it('preserves legacy saved ring settings when no complete schedule config exists yet', () => {
    expect(readStoredScheduleConfig(JSON.stringify({ rings: { count: 3, startTime: '08:30', endTime: '16:30' } }))).toEqual({
      ...config, ringCount: 3, startTime: '08:30', endTime: '16:30',
    });
  });

  it('fails closed instead of overwriting malformed stored settings', () => {
    expect(() => mergeScheduleSettings('{broken', config)).toThrow('Tournament settings require repair');
  });

  it('changes the input version when a division assignment changes', () => {
    const base = [{ id: 'd1', name: 'Patterns', eventType: 'patterns', beltLevel: 'CB', gender: 'M', ageMin: 10, ageMax: 12, assignments: [{ registrationId: 'r1', registration: { competitor: { firstName: 'Amina', lastName: 'Khan' } } }] }];
    expect(scheduleInputVersion(base)).not.toBe(scheduleInputVersion([{ ...base[0], assignments: [{ registrationId: 'r1' }, { registrationId: 'r2' }] }]));
    expect(scheduleInputVersion(base)).not.toBe(scheduleInputVersion([{ ...base[0], assignments: [{ registrationId: 'r1', registration: { competitor: { firstName: 'Amira', lastName: 'Khan' } } }] }]));
  });

  it('versions the exact generated result returned to an idempotent caller', () => {
    const result = { schedule: [{ divisionId: 'd1', divisionName: 'Patterns', ring: 1, startTime: '09:00', endTime: '09:10' }], warnings: [] };
    expect(scheduleResultVersion(result as never)).not.toBe(scheduleResultVersion({ ...result, schedule: [{ ...result.schedule[0], ring: 2 }] } as never));
  });

  it('describes the affected divisions and warnings before application', () => {
    const before = { schedule: [
      { divisionId: 'd1', divisionName: 'Patterns A', ring: 1, startTime: '09:00', endTime: '09:15' },
      { divisionId: 'd2', divisionName: 'Sparring B', ring: 2, startTime: '09:00', endTime: '09:25' },
    ], warnings: [] };
    const after = { schedule: [
      { divisionId: 'd1', divisionName: 'Patterns A', ring: 2, startTime: '09:10', endTime: '09:25' },
      { divisionId: 'd2', divisionName: 'Sparring B', ring: 2, startTime: '09:00', endTime: '09:25' },
    ], warnings: ['Patterns A may run late'] };
    expect(buildScheduleImpact(before as never, after as never)).toEqual({
      affectedDivisionIds: ['d1'], affectedLabels: ['Patterns A'], ringChanges: 1, timeChanges: 1,
      addedWarnings: ['Patterns A may run late'], removedWarnings: [],
    });
  });

  it('atomically saves the confirmed config with an audit record', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tournament = { id: 't1', settings: '{"registrationFee":"45"}', updatedAt: new Date('2026-08-09T14:00:00Z'), divisions: [] };
    const database = {
      $transaction: (work: (tx: unknown) => unknown) => work({
        tournament: { findUnique: vi.fn().mockResolvedValue(tournament), updateMany },
        tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue(null), create },
      }),
    };
    const result = await applyScheduleCorrection(database as never, {
      tournamentId: 't1', config, expectedUpdatedAt: '2026-08-09T14:00:00.000Z', approvedBy: 'u1',
      expectedInputVersion: scheduleInputVersion([]), operationKey: 'operation-1',
      resultVersion: 'result-1',
      impact: { affectedDivisionIds: ['d1'], affectedLabels: ['Patterns A'], ringChanges: 1, timeChanges: 1, addedWarnings: [], removedWarnings: [] },
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1', updatedAt: new Date('2026-08-09T14:00:00.000Z') } }));
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tournamentId: 't1', operationType: 'schedule_regeneration', createdBy: 'u1', reversible: true,
      operationKey: 'operation-1',
    }) });
    expect(result.auditId).toBe('audit-1');
  });

  it('rejects application when the preview snapshot is stale', async () => {
    const database = { $transaction: vi.fn((work: (tx: unknown) => unknown) => work({
      tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue(null) },
      tournament: { findUnique: vi.fn().mockResolvedValue({ id: 't1', settings: null, updatedAt: new Date('2026-08-09T14:01:00Z'), divisions: [] }) },
    })) };
    await expect(applyScheduleCorrection(database as never, {
      tournamentId: 't1', config, expectedUpdatedAt: '2026-08-09T14:00:00.000Z', approvedBy: 'u1',
      expectedInputVersion: 'version-1', operationKey: 'operation-1',
      resultVersion: 'result-1',
      impact: { affectedDivisionIds: [], affectedLabels: [], ringChanges: 0, timeChanges: 0, addedWarnings: [], removedWarnings: [] },
    })).rejects.toThrow('Schedule preview is stale');
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns the canonical audit for an exact operation retry and rejects key reuse with a different result', async () => {
    const impact = { affectedDivisionIds: [], affectedLabels: [], ringChanges: 0, timeChanges: 0, addedWarnings: [], removedWarnings: [] };
    const existing = {
      id: 'audit-1', tournamentId: 't1', operationType: 'schedule_regeneration', undoneAt: null,
      impactSummary: JSON.stringify({ ...impact, _operation: { config, expectedUpdatedAt: '2026-08-09T14:00:00.000Z', expectedInputVersion: 'input-1', resultVersion: 'result-1' } }),
    };
    const database = { $transaction: vi.fn((work: (tx: unknown) => unknown) => work({ tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue(existing) } })) };
    await expect(applyScheduleCorrection(database as never, {
      tournamentId: 't1', config, expectedUpdatedAt: '2026-08-09T14:00:00.000Z', approvedBy: 'u1', impact,
      expectedInputVersion: 'input-1', resultVersion: 'result-1', operationKey: 'operation-1',
    })).resolves.toEqual({ auditId: 'audit-1', alreadyApplied: true, impact });
    await expect(applyScheduleCorrection(database as never, {
      tournamentId: 't1', config: { ...config, ringCount: 3 }, expectedUpdatedAt: '2026-08-09T14:00:00.000Z', approvedBy: 'u1', impact,
      expectedInputVersion: 'input-1', resultVersion: 'result-2', operationKey: 'operation-1',
    })).rejects.toThrow('Schedule operation key is already in use');
  });

  it('undoes only when the applied schedule is still the current state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const afterState = mergeScheduleSettings(null, config);
    const audit = {
        id: 'audit-1', tournamentId: 't1', operationType: 'schedule_regeneration', reversible: true,
        undoneAt: null, beforeState: null, afterState,
      };
    const database = {
      $transaction: (work: (tx: unknown) => unknown) => work({
        tournament: { findUnique: vi.fn().mockResolvedValue({ id: 't1', settings: afterState }), updateMany },
        tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue(audit), updateMany: auditUpdateMany },
      }),
    };
    await undoScheduleCorrection(database as never, 'audit-1', 'u1', new Date('2026-08-09T15:00:00Z'));
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 't1', settings: afterState }, data: { settings: null } });
    expect(auditUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'audit-1', undoneAt: null }, data: expect.objectContaining({ undoneBy: 'u1' }),
    }));
  });

  it('treats a repeated undo as the same successful outcome', async () => {
    const database = { $transaction: vi.fn((work: (tx: unknown) => unknown) => work({
      tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue({ id: 'audit-1', tournamentId: 't1', operationType: 'schedule_regeneration', reversible: true, undoneAt: new Date(), beforeState: null, afterState: '{}' }) },
    })) };
    await expect(undoScheduleCorrection(database as never, 'audit-1', 'u1', new Date(), 't1')).resolves.toBeUndefined();
  });
});

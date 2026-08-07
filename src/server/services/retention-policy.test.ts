import { describe, expect, it, vi } from 'vitest';
import {
  calculateRetentionCutoff,
  purgeExpiredSoftDeletes,
  retentionConfigFromEnv,
  startRetentionPurgeJob,
} from './retention-policy.js';

describe('calculateRetentionCutoff', () => {
  it('returns the exact UTC cutoff for the configured retention period', () => {
    const now = new Date('2026-08-07T12:00:00.000Z');

    expect(calculateRetentionCutoff(now, 7)).toEqual(new Date('2026-07-31T12:00:00.000Z'));
  });

  it('rejects retention periods shorter than one day', () => {
    expect(() => calculateRetentionCutoff(new Date(), 0)).toThrow('at least 1 day');
  });
});

describe('purgeExpiredSoftDeletes', () => {
  it('purges only records soft-deleted on or before the cutoff and reports counts', async () => {
    const deleteMany = vi.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 4 });
    const database = {
      incident: { deleteMany },
      division: { deleteMany },
      tournament: { deleteMany },
      competitor: { deleteMany },
    };
    const cutoff = new Date('2026-07-31T12:00:00.000Z');

    const result = await purgeExpiredSoftDeletes(database, cutoff);

    expect(deleteMany).toHaveBeenCalledTimes(4);
    for (const [args] of deleteMany.mock.calls) {
      expect(args).toEqual({ where: { deletedAt: { lte: cutoff } } });
    }
    expect(result).toEqual({ incidents: 2, divisions: 3, tournaments: 1, competitors: 4, total: 10 });
  });
});

describe('startRetentionPurgeJob', () => {
  it('runs once at startup and schedules recurring purges with the configured cutoff', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = {
      incident: { deleteMany },
      division: { deleteMany },
      tournament: { deleteMany },
      competitor: { deleteMany },
    };
    let scheduled: (() => void) | undefined;
    const schedule = vi.fn((callback: () => void, intervalMs: number) => {
      scheduled = callback;
      expect(intervalMs).toBe(86_400_000);
      return { unref: vi.fn() };
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const now = () => new Date('2026-08-07T12:00:00.000Z');

    await startRetentionPurgeJob({ database, retentionDays: 7, intervalMs: 86_400_000, now, schedule, logger });

    expect(deleteMany).toHaveBeenCalledTimes(4);
    expect(schedule).toHaveBeenCalledTimes(1);
    scheduled?.();
    await vi.waitFor(() => expect(deleteMany).toHaveBeenCalledTimes(8));
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('retentionConfigFromEnv', () => {
  it('stays disabled unless an operator explicitly enables destructive retention', () => {
    expect(retentionConfigFromEnv({})).toBeNull();
    expect(retentionConfigFromEnv({ RETENTION_PURGE_ENABLED: 'false' })).toBeNull();
  });

  it('uses a seven-day retention period when explicitly enabled', () => {
    expect(retentionConfigFromEnv({ RETENTION_PURGE_ENABLED: 'true' })).toEqual({
      retentionDays: 7,
      intervalMs: 86_400_000,
    });
  });

  it('rejects an invalid enabled retention period instead of silently choosing one', () => {
    expect(() => retentionConfigFromEnv({
      RETENTION_PURGE_ENABLED: 'true',
      SOFT_DELETE_RETENTION_DAYS: '0',
    })).toThrow('SOFT_DELETE_RETENTION_DAYS');
  });
});

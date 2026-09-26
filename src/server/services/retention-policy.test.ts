import { describe, expect, it, vi } from 'vitest';
import {
  calculateRetentionCutoff,
  purgeExpiredSoftDeletes,
  retentionConfigFromEnv,
  startRetentionPurgeJob,
  RETENTION_TRANSACTION_TIMEOUT_MS,
  type RetentionDatabase,
  type RetentionDelegates,
} from './retention-policy.js';

type DeleteManyFn = RetentionDelegates['incident']['deleteMany'];
type TransactionFn = RetentionDatabase['$transaction'];

/**
 * Builds an in-memory database whose `$transaction` hands the callback the
 * same delegates.
 */
function makeDatabase(deleteMany: DeleteManyFn) {
  const delegates: RetentionDelegates = {
    incident: { deleteMany },
    division: { deleteMany },
    tournament: { deleteMany },
    competitor: { deleteMany },
  };
  const $transaction = vi.fn<TransactionFn>((fn) => fn(delegates));
  return { ...delegates, $transaction };
}

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
    const database = makeDatabase(deleteMany);
    const cutoff = new Date('2026-07-31T12:00:00.000Z');

    const result = await purgeExpiredSoftDeletes(database, cutoff);

    expect(deleteMany).toHaveBeenCalledTimes(4);
    for (const [args] of deleteMany.mock.calls) {
      expect(args).toEqual({ where: { deletedAt: { lte: cutoff } } });
    }
    expect(result).toEqual({ incidents: 2, divisions: 3, tournaments: 1, competitors: 4, total: 10 });
  });

  it('runs every delete inside one transaction, never against the root client', async () => {
    const rootDeleteMany = vi.fn().mockResolvedValue({ count: 99 });
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txDelegates: RetentionDelegates = {
      incident: { deleteMany: txDeleteMany },
      division: { deleteMany: txDeleteMany },
      tournament: { deleteMany: txDeleteMany },
      competitor: { deleteMany: txDeleteMany },
    };
    const $transaction = vi.fn<TransactionFn>((fn) => fn(txDelegates));
    const database: RetentionDatabase = {
      incident: { deleteMany: rootDeleteMany },
      division: { deleteMany: rootDeleteMany },
      tournament: { deleteMany: rootDeleteMany },
      competitor: { deleteMany: rootDeleteMany },
      $transaction,
    };

    const result = await purgeExpiredSoftDeletes(database, new Date('2026-07-31T12:00:00.000Z'));

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({ timeout: RETENTION_TRANSACTION_TIMEOUT_MS });
    expect(txDeleteMany).toHaveBeenCalledTimes(4);
    expect(rootDeleteMany).not.toHaveBeenCalled();
    expect(result.total).toBe(4);
  });

  it('propagates a mid-purge failure so the transaction rolls back and nothing is reported as purged', async () => {
    const deleteMany = vi.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 })
      .mockRejectedValueOnce(new Error('FK violation'));
    const committed: string[] = [];
    const database = makeDatabase(deleteMany);
    database.$transaction.mockImplementation(async (fn) => {
      // Emulate an all-or-nothing commit: only record success when the
      // callback resolves.
      const value = await fn(database);
      committed.push('commit');
      return value;
    });

    await expect(purgeExpiredSoftDeletes(database, new Date())).rejects.toThrow('FK violation');
    expect(committed).toEqual([]);
    // The fourth delete is never attempted after the third fails.
    expect(deleteMany).toHaveBeenCalledTimes(3);
  });
});

describe('startRetentionPurgeJob', () => {
  it('runs once at startup and schedules recurring purges with the configured cutoff', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = makeDatabase(deleteMany);
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
    expect(database.$transaction).toHaveBeenCalledTimes(2);
  });

  it('logs and keeps scheduling when a purge transaction fails', async () => {
    const deleteMany = vi.fn().mockRejectedValue(new Error('db down'));
    const database = makeDatabase(deleteMany);
    const schedule = vi.fn(() => ({ unref: vi.fn() }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await startRetentionPurgeJob({ database, retentionDays: 7, intervalMs: 1000, schedule, logger });

    expect(logger.error).toHaveBeenCalledWith('[retention] purge failed', expect.any(Error));
    expect(logger.info).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
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

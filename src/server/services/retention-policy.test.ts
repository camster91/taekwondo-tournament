import { describe, expect, it, vi } from 'vitest';
import {
  calculateRetentionCutoff,
  purgeExpiredSoftDeletes,
  retentionConfigFromEnv,
  retentionWhere,
  startRetentionPurgeJob,
  RETENTION_TRANSACTION_TIMEOUT_MS,
  type RetentionDatabase,
  type RetentionTransaction,
} from './retention-policy.js';

type DeleteManyFn = RetentionTransaction['incident']['deleteMany'];
type CountFn = RetentionTransaction['incident']['count'];
type TransactionFn = RetentionDatabase['$transaction'];

/**
 * Builds an in-memory database whose `$transaction` hands the callback the
 * same delegates.
 */
function makeDatabase(deleteMany: DeleteManyFn, count: CountFn = vi.fn().mockResolvedValue(0)) {
  const create = vi.fn().mockResolvedValue({});
  const delegates: RetentionTransaction = {
    incident: { deleteMany, count },
    division: { deleteMany, count },
    tournament: { deleteMany, count },
    competitor: { deleteMany, count },
    retentionPurgeRun: { create },
  };
  const $transaction = vi.fn<TransactionFn>((fn) => fn(delegates));
  return { ...delegates, $transaction, create };
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

describe('retentionWhere (legal hold)', () => {
  const cutoff = new Date('2026-07-31T12:00:00.000Z');
  const where = retentionWhere(cutoff);

  it('only matches records soft-deleted on or before the cutoff', () => {
    for (const filter of Object.values(where)) {
      expect(filter).toMatchObject({ deletedAt: { lte: cutoff } });
    }
  });

  it('excludes held tournaments and everything that belongs to them', () => {
    expect(where.tournament).toMatchObject({ legalHoldAt: null });
    expect(where.division).toMatchObject({ tournament: { legalHoldAt: null } });
    expect(where.incident).toMatchObject({ tournament: { legalHoldAt: null } });
  });

  it('excludes held competitors and competitors registered in a held tournament', () => {
    expect(where.competitor).toMatchObject({
      legalHoldAt: null,
      registrations: { none: { tournament: { legalHoldAt: { not: null } } } },
    });
  });
});

describe('purgeExpiredSoftDeletes', () => {
  it('purges with the legal-hold-aware filters and reports counts', async () => {
    const deleteMany = vi.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 4 });
    const database = makeDatabase(deleteMany);
    const cutoff = new Date('2026-07-31T12:00:00.000Z');
    const where = retentionWhere(cutoff);

    const result = await purgeExpiredSoftDeletes(database, cutoff);

    expect(deleteMany.mock.calls.map(([args]) => args)).toEqual([
      { where: where.incident },
      { where: where.division },
      { where: where.tournament },
      { where: where.competitor },
    ]);
    expect(result).toEqual({ incidents: 2, divisions: 3, tournaments: 1, competitors: 4, total: 10, dryRun: false });
  });

  it('records the run inside the same transaction as the deletes', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = makeDatabase(deleteMany);
    const cutoff = new Date('2026-07-31T12:00:00.000Z');
    database.$transaction.mockImplementation(async (fn) => {
      // The audit row must be written before the transaction commits.
      const value = await fn(database);
      expect(database.create).toHaveBeenCalledTimes(1);
      return value;
    });

    await purgeExpiredSoftDeletes(database, cutoff);

    expect(database.create).toHaveBeenCalledWith({
      data: { cutoff, dryRun: false, incidents: 1, divisions: 1, tournaments: 1, competitors: 1 },
    });
  });

  it('dry run counts with the same filters, deletes nothing, and records the run', async () => {
    const deleteMany = vi.fn();
    const count = vi.fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const database = makeDatabase(deleteMany, count);
    const cutoff = new Date('2026-07-31T12:00:00.000Z');
    const where = retentionWhere(cutoff);

    const result = await purgeExpiredSoftDeletes(database, cutoff, { dryRun: true });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(count.mock.calls.map(([args]) => args)).toEqual([
      { where: where.incident },
      { where: where.division },
      { where: where.tournament },
      { where: where.competitor },
    ]);
    expect(result).toEqual({ incidents: 5, divisions: 0, tournaments: 2, competitors: 1, total: 8, dryRun: true });
    expect(database.create).toHaveBeenCalledWith({
      data: { cutoff, dryRun: true, incidents: 5, divisions: 0, tournaments: 2, competitors: 1 },
    });
  });

  it('runs every delete inside one transaction, never against the root client', async () => {
    const rootDeleteMany = vi.fn().mockResolvedValue({ count: 99 });
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const count = vi.fn().mockResolvedValue(0);
    const txCreate = vi.fn().mockResolvedValue({});
    const rootCreate = vi.fn().mockResolvedValue({});
    const txDelegates: RetentionTransaction = {
      incident: { deleteMany: txDeleteMany, count },
      division: { deleteMany: txDeleteMany, count },
      tournament: { deleteMany: txDeleteMany, count },
      competitor: { deleteMany: txDeleteMany, count },
      retentionPurgeRun: { create: txCreate },
    };
    const $transaction = vi.fn<TransactionFn>((fn) => fn(txDelegates));
    const database: RetentionDatabase = {
      incident: { deleteMany: rootDeleteMany, count },
      division: { deleteMany: rootDeleteMany, count },
      tournament: { deleteMany: rootDeleteMany, count },
      competitor: { deleteMany: rootDeleteMany, count },
      retentionPurgeRun: { create: rootCreate },
      $transaction,
    };

    const result = await purgeExpiredSoftDeletes(database, new Date('2026-07-31T12:00:00.000Z'));

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({ timeout: RETENTION_TRANSACTION_TIMEOUT_MS });
    expect(txDeleteMany).toHaveBeenCalledTimes(4);
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(rootDeleteMany).not.toHaveBeenCalled();
    expect(rootCreate).not.toHaveBeenCalled();
    expect(result.total).toBe(4);
  });

  it('propagates a mid-purge failure so the transaction rolls back and nothing is recorded', async () => {
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
    // The fourth delete and the audit row are never attempted.
    expect(deleteMany).toHaveBeenCalledTimes(3);
    expect(database.create).not.toHaveBeenCalled();
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

  it('in dry-run mode only counts and logs what it would purge', async () => {
    const deleteMany = vi.fn();
    const count = vi.fn().mockResolvedValue(3);
    const database = makeDatabase(deleteMany, count);
    const logger = { info: vi.fn(), error: vi.fn() };

    await startRetentionPurgeJob({
      database, retentionDays: 7, intervalMs: 1000, dryRun: true,
      schedule: vi.fn(() => ({ unref: vi.fn() })), logger,
    });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('DRY RUN: would purge 12'));
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
      dryRun: false,
    });
  });

  it('supports a dry-run mode', () => {
    expect(retentionConfigFromEnv({ RETENTION_PURGE_ENABLED: 'true', RETENTION_PURGE_DRY_RUN: 'true' }))
      .toMatchObject({ dryRun: true });
  });

  it('rejects an invalid enabled retention period instead of silently choosing one', () => {
    expect(() => retentionConfigFromEnv({
      RETENTION_PURGE_ENABLED: 'true',
      SOFT_DELETE_RETENTION_DAYS: '0',
    })).toThrow('SOFT_DELETE_RETENTION_DAYS');
  });
});

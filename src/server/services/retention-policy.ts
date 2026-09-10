const DAY_MS = 24 * 60 * 60 * 1000;

type DeleteResult = { count: number };
type SoftDeleteDelegate = {
  deleteMany(args: { where: { deletedAt: { lte: Date } } }): Promise<DeleteResult>;
};

export type RetentionDatabase = {
  incident: SoftDeleteDelegate;
  division: SoftDeleteDelegate;
  tournament: SoftDeleteDelegate;
  competitor: SoftDeleteDelegate;
  /**
   * Optional transaction runner. When provided, all four
   * `deleteMany` calls in a single purge run are wrapped in a
   * single transaction so a partial failure rolls back instead
   * of leaving the soft-delete trash in a half-purged state
   * (closes MEDIUM #8 from the backend review).
   *
   * Production wires this to Prisma's `$transaction`. Tests that
   * don't care about atomicity can omit it; the four deletes
   * then run sequentially on the shared `database` object, which
   * keeps the existing in-memory mocks trivial.
   */
  runInTransaction?<R>(work: (tx: RetentionDatabase) => Promise<R>): Promise<R>;
};

export type RetentionPurgeResult = {
  incidents: number;
  divisions: number;
  tournaments: number;
  competitors: number;
  total: number;
};

export function retentionConfigFromEnv(
  env: Record<string, string | undefined>,
): { retentionDays: number; intervalMs: number } | null {
  if (env.RETENTION_PURGE_ENABLED !== 'true') return null;

  const rawDays = env.SOFT_DELETE_RETENTION_DAYS ?? '7';
  const retentionDays = Number(rawDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('SOFT_DELETE_RETENTION_DAYS must be an integer of at least 1');
  }
  return { retentionDays, intervalMs: DAY_MS };
}

export function calculateRetentionCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new RangeError('Retention period must be at least 1 day');
  }
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

export async function purgeExpiredSoftDeletes(
  database: RetentionDatabase,
  cutoff: Date,
): Promise<RetentionPurgeResult> {
  const where = { deletedAt: { lte: cutoff } };

  // MEDIUM #8: the four deletes are mutually independent in
  // business terms, but they share a `deletedAt` clock. If the
  // 3rd or 4th call fails the database is left in a state where
  // e.g. Tournaments are hard-deleted but their child Divisions
  // remain soft-deleted (and will stay soft-deleted forever since
  // the next purge sees the same cutoff). Wrapping the four
  // calls in a single Prisma `$transaction` makes the run
  // all-or-nothing so the next purge starts from a clean slate.
  //
  // The optional `runInTransaction` keeps the in-memory mock
  // contract unchanged for tests that don't model transactions.
  const run = async (tx: RetentionDatabase) => {
    const incidents = await tx.incident.deleteMany({ where });
    const divisions = await tx.division.deleteMany({ where });
    const tournaments = await tx.tournament.deleteMany({ where });
    const competitors = await tx.competitor.deleteMany({ where });
    return {
      incidents: incidents.count,
      divisions: divisions.count,
      tournaments: tournaments.count,
      competitors: competitors.count,
      total: incidents.count + divisions.count + tournaments.count + competitors.count,
    };
  };

  if (typeof database.runInTransaction === 'function') {
    return database.runInTransaction(run);
  }
  return run(database);
}

type RetentionLogger = {
  info(message: string): void;
  error(message: string, error?: unknown): void;
};

type RetentionScheduler = (
  callback: () => void,
  intervalMs: number,
) => { unref?: () => unknown };

type StartRetentionPurgeOptions = {
  database: RetentionDatabase;
  retentionDays: number;
  intervalMs: number;
  now?: () => Date;
  schedule?: RetentionScheduler;
  logger?: RetentionLogger;
};

export async function startRetentionPurgeJob({
  database,
  retentionDays,
  intervalMs,
  now = () => new Date(),
  schedule = setInterval,
  logger = console,
}: StartRetentionPurgeOptions): Promise<void> {
  const run = async () => {
    try {
      const cutoff = calculateRetentionCutoff(now(), retentionDays);
      const result = await purgeExpiredSoftDeletes(database, cutoff);
      logger.info(`[retention] purged ${result.total} expired soft-deleted records`);
    } catch (error) {
      logger.error('[retention] purge failed', error);
    }
  };

  await run();
  const timer = schedule(() => void run(), intervalMs);
  timer.unref?.();
}

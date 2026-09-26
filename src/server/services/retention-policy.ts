const DAY_MS = 24 * 60 * 60 * 1000;

type DeleteResult = { count: number };
type SoftDeleteDelegate = {
  deleteMany(args: { where: { deletedAt: { lte: Date } } }): Promise<DeleteResult>;
};

export type RetentionDelegates = {
  incident: SoftDeleteDelegate;
  division: SoftDeleteDelegate;
  tournament: SoftDeleteDelegate;
  competitor: SoftDeleteDelegate;
};

/**
 * The purge runs four dependent deletes. They must commit or roll back
 * together: a failure part-way through used to leave, e.g., tournaments
 * purged while their soft-deleted divisions/competitors lingered. The
 * database therefore has to expose an interactive transaction (Prisma's
 * `$transaction(fn, options)` satisfies this shape structurally).
 */
export type RetentionDeleteResults = Record<keyof RetentionDelegates, DeleteResult>;

export type RetentionDatabase = RetentionDelegates & {
  $transaction(
    fn: (tx: RetentionDelegates) => Promise<RetentionDeleteResults>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<RetentionDeleteResults>;
};

/**
 * A large backlog (first run after enabling retention) can take longer
 * than Prisma's 5 s default interactive-transaction timeout.
 */
export const RETENTION_TRANSACTION_TIMEOUT_MS = 120_000;

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
  const { incident: incidents, division: divisions, tournament: tournaments, competitor: competitors } = await database.$transaction(
    async (tx) => ({
      incident: await tx.incident.deleteMany({ where }),
      division: await tx.division.deleteMany({ where }),
      tournament: await tx.tournament.deleteMany({ where }),
      competitor: await tx.competitor.deleteMany({ where }),
    }),
    { timeout: RETENTION_TRANSACTION_TIMEOUT_MS },
  );
  return {
    incidents: incidents.count,
    divisions: divisions.count,
    tournaments: tournaments.count,
    competitors: competitors.count,
    total: incidents.count + divisions.count + tournaments.count + competitors.count,
  };
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

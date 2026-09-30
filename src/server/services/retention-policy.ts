const DAY_MS = 24 * 60 * 60 * 1000;

type DeleteResult = { count: number };
type Where = Record<string, unknown>;
type SoftDeleteDelegate = {
  deleteMany(args: { where: Where }): Promise<DeleteResult>;
  count(args: { where: Where }): Promise<number>;
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

export type RetentionPurgeRunRecord = {
  cutoff: Date;
  dryRun: boolean;
  incidents: number;
  divisions: number;
  tournaments: number;
  competitors: number;
};

type PurgeRunDelegate = { create(args: { data: RetentionPurgeRunRecord }): Promise<unknown> };
export type RetentionTransaction = RetentionDelegates & { retentionPurgeRun: PurgeRunDelegate };

export type RetentionDatabase = RetentionTransaction & {
  $transaction(
    fn: (tx: RetentionTransaction) => Promise<RetentionDeleteResults>,
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
  dryRun: boolean;
};

/**
 * Filters for records that are past the cutoff AND not under legal hold.
 * A hold on a tournament also protects its soft-deleted divisions and
 * incidents, and every competitor registered in it (deleting a
 * competitor cascades to its registrations, including the held
 * tournament's).
 */
export function retentionWhere(cutoff: Date): Record<keyof RetentionDelegates, Where> {
  const expired = { deletedAt: { lte: cutoff } };
  return {
    incident: { ...expired, tournament: { legalHoldAt: null } },
    division: { ...expired, tournament: { legalHoldAt: null } },
    tournament: { ...expired, legalHoldAt: null },
    competitor: {
      ...expired,
      legalHoldAt: null,
      registrations: { none: { tournament: { legalHoldAt: { not: null } } } },
    },
  };
}

export function retentionConfigFromEnv(
  env: Record<string, string | undefined>,
): { retentionDays: number; intervalMs: number; dryRun: boolean } | null {
  if (env.RETENTION_PURGE_ENABLED !== 'true') return null;
  const dryRun = env.RETENTION_PURGE_DRY_RUN === 'true';

  const rawDays = env.SOFT_DELETE_RETENTION_DAYS ?? '7';
  const retentionDays = Number(rawDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('SOFT_DELETE_RETENTION_DAYS must be an integer of at least 1');
  }
  return { retentionDays, intervalMs: DAY_MS, dryRun };
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
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<RetentionPurgeResult> {
  const where = retentionWhere(cutoff);
  let counts: Record<keyof RetentionDelegates, number>;
  if (dryRun) {
    // Same filters, nothing deleted: shows what the next real run would purge.
    counts = {
      incident: await database.incident.count({ where: where.incident }),
      division: await database.division.count({ where: where.division }),
      tournament: await database.tournament.count({ where: where.tournament }),
      competitor: await database.competitor.count({ where: where.competitor }),
    };
  } else {
    // The audit row is written in the same transaction, so a purge and
    // its record commit (or roll back) together.
    const deleted = await database.$transaction(
      async (tx) => {
        const results = {
          incident: await tx.incident.deleteMany({ where: where.incident }),
          division: await tx.division.deleteMany({ where: where.division }),
          tournament: await tx.tournament.deleteMany({ where: where.tournament }),
          competitor: await tx.competitor.deleteMany({ where: where.competitor }),
        };
        await tx.retentionPurgeRun.create({
          data: {
            cutoff,
            dryRun: false,
            incidents: results.incident.count,
            divisions: results.division.count,
            tournaments: results.tournament.count,
            competitors: results.competitor.count,
          },
        });
        return results;
      },
      { timeout: RETENTION_TRANSACTION_TIMEOUT_MS },
    );
    counts = {
      incident: deleted.incident.count,
      division: deleted.division.count,
      tournament: deleted.tournament.count,
      competitor: deleted.competitor.count,
    };
  }
  const result: RetentionPurgeResult = {
    incidents: counts.incident,
    divisions: counts.division,
    tournaments: counts.tournament,
    competitors: counts.competitor,
    total: counts.incident + counts.division + counts.tournament + counts.competitor,
    dryRun,
  };
  if (dryRun) {
    await database.retentionPurgeRun.create({
      data: {
        cutoff,
        dryRun: true,
        incidents: result.incidents,
        divisions: result.divisions,
        tournaments: result.tournaments,
        competitors: result.competitors,
      },
    });
  }
  return result;
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
  dryRun?: boolean;
  now?: () => Date;
  schedule?: RetentionScheduler;
  logger?: RetentionLogger;
};

export async function startRetentionPurgeJob({
  database,
  retentionDays,
  intervalMs,
  dryRun = false,
  now = () => new Date(),
  schedule = setInterval,
  logger = console,
}: StartRetentionPurgeOptions): Promise<void> {
  const run = async () => {
    try {
      const cutoff = calculateRetentionCutoff(now(), retentionDays);
      const result = await purgeExpiredSoftDeletes(database, cutoff, { dryRun });
      const detail = `tournaments=${result.tournaments} divisions=${result.divisions} competitors=${result.competitors} incidents=${result.incidents}`;
      logger.info(dryRun
        ? `[retention] DRY RUN: would purge ${result.total} expired soft-deleted records (${detail})`
        : `[retention] purged ${result.total} expired soft-deleted records (${detail})`);
    } catch (error) {
      logger.error('[retention] purge failed', error);
    }
  };

  await run();
  const timer = schedule(() => void run(), intervalMs);
  timer.unref?.();
}

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
  const incidents = await database.incident.deleteMany({ where });
  const divisions = await database.division.deleteMany({ where });
  const tournaments = await database.tournament.deleteMany({ where });
  const competitors = await database.competitor.deleteMany({ where });
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

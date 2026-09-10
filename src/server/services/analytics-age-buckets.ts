/**
 * HIGH #4 (backend review): age-bucket aggregation for the
 * /api/analytics/dashboard endpoint.
 *
 * The previous handler did an unbounded `prisma.competitor.findMany`
 * with `select: { dateOfBirth: true }` to compute age buckets in
 * JavaScript. That loaded every `dateOfBirth` row into the Node
 * process — OOM at scale, and a PII hot path.
 *
 * The replacement computes the same buckets in a single
 * parameterized `SELECT … GROUP BY …` and returns just the six
 * counts. No PII ever leaves the database.
 *
 * Kept as a pure module (no Prisma client, no auth calls) so the
 * SQL builder + bucket parser can be unit-tested without a live
 * database. The route still does the I/O.
 */
import { Prisma } from '@prisma/client';

/**
 * Canonical bucket labels in display order. The dashboard
 * rendering iterates these in order, so the SQL output must
 * surface them even when a bucket has zero rows.
 */
export const AGE_BUCKETS = ['4-7', '8-11', '12-14', '15-17', '18-35', '36+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/**
 * Result shape returned by `bucketizeAgeGroups` / the SQL
 * aggregation. Every key in `AGE_BUCKETS` is always present so
 * the dashboard doesn't have to defend against a missing bucket.
 */
export type AgeBucketCounts = Record<AgeBucket, number>;

/**
 * Zeroed-out bucket record. Useful as a starting point before
 * folding the SQL result over it.
 */
export function emptyAgeBucketCounts(): AgeBucketCounts {
  return AGE_BUCKETS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as AgeBucketCounts);
}

/**
 * Coerce a single SQL `bucket` string into the union type.
 * The query only ever returns one of these values, but Postgres
 * gives it back as `unknown`; this helper keeps the call site
 * honest.
 */
function asBucket(value: unknown): AgeBucket | null {
  if (typeof value !== 'string') return null;
  return (AGE_BUCKETS as readonly string[]).includes(value)
    ? (value as AgeBucket)
    : null;
}

/**
 * Fold the raw SQL result rows into a fully-populated
 * `AgeBucketCounts`. Missing buckets stay at zero.
 *
 * Input shape (one row per non-empty bucket):
 *   { bucket: '4-7', count: BigInt | number }
 */
export function bucketizeAgeGroups(
  rows: Array<{ bucket: unknown; count: unknown }>,
): AgeBucketCounts {
  const out = emptyAgeBucketCounts();
  for (const row of rows) {
    const bucket = asBucket(row.bucket);
    if (!bucket) continue;
    // Prisma returns COUNT() as bigint for postgres, but a
    // plain number for sqlite. Coerce to a JS number so the
    // JSON response shape stays consistent across databases.
    const raw = row.count;
    const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    out[bucket] = n;
  }
  return out;
}

/**
 * Build a parameterized SQL query that produces the six age
 * bucket counts. The `where` parameter must be the
 * `Prisma.Sql`-compatible clause for the Competitor model
 * (i.e. the soft-delete + tournament-access filter built by
 * analytics-validation.ts). We use `date_part('year', age(...))`
 * to compute the integer age in Postgres and a CASE to bucket.
 *
 * Why we use raw SQL:
 * - groupBy on `dateOfBirth` would return one row per distinct
 *   DOB (very high cardinality, defeats the purpose of grouping).
 * - Computing the bucket in JS would require loading every DOB
 *   back into Node (the bug we're fixing).
 *
 * The query is parameterized end-to-end so user-supplied values
 * cannot affect the SQL structure.
 */
export function buildAgeBucketQuery(where: Prisma.Sql): Prisma.Sql {
  // Postgres-specific: `date_part('year', age(now(), "dateOfBirth"))`
  // returns the integer age. age() handles leap years correctly,
  // matching the prior JS implementation.
  return Prisma.sql`
    SELECT
      CASE
        WHEN date_part('year', age(now(), "dateOfBirth")) BETWEEN 4  AND 7  THEN '4-7'
        WHEN date_part('year', age(now(), "dateOfBirth")) BETWEEN 8  AND 11 THEN '8-11'
        WHEN date_part('year', age(now(), "dateOfBirth")) BETWEEN 12 AND 14 THEN '12-14'
        WHEN date_part('year', age(now(), "dateOfBirth")) BETWEEN 15 AND 17 THEN '15-17'
        WHEN date_part('year', age(now(), "dateOfBirth")) BETWEEN 18 AND 35 THEN '18-35'
        WHEN date_part('year', age(now(), "dateOfBirth")) >= 36           THEN '36+'
        ELSE NULL
      END AS bucket,
      COUNT(*) AS count
    FROM "Competitor"
    WHERE ${where} AND "dateOfBirth" IS NOT NULL
    GROUP BY bucket
  `;
}

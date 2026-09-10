/**
 * HIGH #4 (backend review): unit tests for the age-bucket SQL
 * helper. The pure functions (`emptyAgeBucketCounts`,
 * `bucketizeAgeGroups`) are tested directly so the route's
 * behavior is provable without a live database.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  AGE_BUCKETS,
  bucketizeAgeGroups,
  buildAgeBucketQuery,
  emptyAgeBucketCounts,
} from './analytics-age-buckets.js';

describe('emptyAgeBucketCounts', () => {
  it('returns a record with all six buckets set to zero', () => {
    const counts = emptyAgeBucketCounts();
    for (const bucket of AGE_BUCKETS) {
      expect(counts[bucket]).toBe(0);
    }
  });

  it('returns a fresh object on every call (no shared state)', () => {
    const a = emptyAgeBucketCounts();
    const b = emptyAgeBucketCounts();
    a['4-7'] = 5;
    expect(b['4-7']).toBe(0);
  });
});

describe('bucketizeAgeGroups', () => {
  it('returns all-zero buckets when given an empty result set', () => {
    const counts = bucketizeAgeGroups([]);
    for (const bucket of AGE_BUCKETS) {
      expect(counts[bucket]).toBe(0);
    }
  });

  it('maps SQL rows onto the right buckets (string counts)', () => {
    const counts = bucketizeAgeGroups([
      { bucket: '4-7', count: 2 },
      { bucket: '8-11', count: 5 },
      { bucket: '12-14', count: 3 },
      { bucket: '15-17', count: 1 },
      { bucket: '18-35', count: 8 },
      { bucket: '36+', count: 0 },
    ]);
    expect(counts).toEqual({
      '4-7': 2,
      '8-11': 5,
      '12-14': 3,
      '15-17': 1,
      '18-35': 8,
      '36+': 0,
    });
  });

  it('coerces BigInt counts (Prisma postgres default for COUNT) to numbers', () => {
    // Real Prisma returns COUNT() as BigInt on postgres. The
    // dashboard JSON response must be a plain number, so the
    // helper has to do the coercion.
    const counts = bucketizeAgeGroups([
      { bucket: '4-7', count: 2n },
      { bucket: '8-11', count: 0n },
    ]);
    expect(counts['4-7']).toBe(2);
    expect(counts['8-11']).toBe(0);
    expect(typeof counts['4-7']).toBe('number');
  });

  it('keeps untouched buckets at zero when only some rows are present', () => {
    // The route does not need to pre-fill missing buckets
    // before calling the helper; the helper handles that.
    const counts = bucketizeAgeGroups([{ bucket: '18-35', count: 4 }]);
    expect(counts).toEqual({
      '4-7': 0,
      '8-11': 0,
      '12-14': 0,
      '15-17': 0,
      '18-35': 4,
      '36+': 0,
    });
  });

  it('ignores rows with an unknown bucket label (defensive)', () => {
    // The CASE expression can produce NULL when age < 4; we
    // treat that as "not bucketed" and silently drop it. A
    // future schema change that adds a new bucket would also
    // land here until the helper is updated.
    const counts = bucketizeAgeGroups([
      { bucket: null, count: 9 },
      { bucket: '4-7', count: 1 },
      { bucket: 'mystery', count: 99 },
    ]);
    expect(counts['4-7']).toBe(1);
    expect(counts['8-11']).toBe(0);
  });

  it('ignores rows with non-finite or negative counts', () => {
    const counts = bucketizeAgeGroups([
      { bucket: '4-7', count: Number.NaN },
      { bucket: '8-11', count: -3 },
      { bucket: '12-14', count: 2 },
    ]);
    expect(counts['4-7']).toBe(0);
    expect(counts['8-11']).toBe(0);
    expect(counts['12-14']).toBe(2);
  });
});

describe('buildAgeBucketQuery', () => {
  it('produces a parameterized query that references the supplied where clause', () => {
    const where = Prisma.sql`"deletedAt" IS NULL AND "organizationId" = ${'org-1'}::text`;
    const sql = buildAgeBucketQuery(where);

    // The query must contain a CASE expression and a GROUP BY —
    // the structural elements that prove the bucketing happens
    // in SQL. We assert on the rendered string rather than
    // comparing to a hard-coded query, because Prisma's SQL
    // builder formats placeholders in a version-specific way.
    const rendered = sql.text;
    expect(rendered).toContain('CASE');
    expect(rendered).toContain('GROUP BY');
    expect(rendered).toContain('"Competitor"');
    expect(rendered).toContain('"dateOfBirth"');
    // The supplied where clause must be embedded so the
    // tenant-scoping still applies.
    expect(rendered).toContain('"deletedAt"');
  });

  it('treats NULL dateOfBirth as not bucketed (filter excludes them from the count)', () => {
    // The query must include the `IS NOT NULL` guard so
    // legacy rows with no DOB don't inflate the totals.
    const sql = buildAgeBucketQuery(Prisma.sql`TRUE`);
    expect(sql.text).toContain('"dateOfBirth" IS NOT NULL');
  });
});

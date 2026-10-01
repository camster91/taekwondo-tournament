import { describe, expect, it, vi } from 'vitest';
import { importFromExcel, parseDateOfBirth } from './excel-import.js';

const mapping = {
  firstName: 'First',
  lastName: 'Last',
  gender: 'Gender',
  belt: 'Belt',
  weight: 'Weight',
  dateOfBirth: 'DOB',
  age: 'Age',
};

function prismaDouble(existing: unknown = { id: 'existing-1' }) {
  const tx = {
    competitor: {
      findFirst: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return { tx, prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any };
}

const row = (extra: Record<string, unknown>) => ({
  First: 'Minho', Last: 'Kim', Gender: 'M', Belt: 'Blue', Weight: '80', ...extra,
});

describe('importFromExcel — tenant-safe matching', () => {
  it('matches only inside the provided scope and excludes soft-deleted rows', async () => {
    const { tx, prisma } = prismaDouble();
    const scope = { registrations: { every: { tournament: { organizationId: { in: ['org-1'] } } } } };

    const result = await importFromExcel(prisma, [row({ DOB: '2014-03-15' })], mapping, { matchScope: scope });

    expect(result.updated).toBe(1);
    const where = tx.competitor.findFirst.mock.calls[0][0].where;
    expect(where.AND).toEqual([scope]);
    expect(where.deletedAt).toBeNull();
  });

  it("defaults to 'none': never matches, always creates", async () => {
    const { tx, prisma } = prismaDouble();

    const result = await importFromExcel(prisma, [row({ DOB: '2014-03-15' })], mapping);

    expect(tx.competitor.findFirst).not.toHaveBeenCalled();
    expect(tx.competitor.update).not.toHaveBeenCalled();
    expect(result.imported).toBe(1);
  });

  it("'all' (admin) matches globally", async () => {
    const { tx, prisma } = prismaDouble();

    await importFromExcel(prisma, [row({ DOB: '2014-03-15' })], mapping, { matchScope: 'all' });

    expect(tx.competitor.findFirst.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('a synthetic Jan-1 DOB is never an exact match key; age-only rows match on name + school + birth year (D12)', async () => {
    const { tx, prisma } = prismaDouble();

    const result = await importFromExcel(
      prisma,
      [row({ Age: '11', First: ' Minho ', Last: 'Kim', School: 'Celis  TKD' })],
      { ...mapping, school: 'School' },
      { matchScope: 'all' },
    );

    const where = tx.competitor.findFirst.mock.calls[0][0].where;
    const birthYear = new Date().getUTCFullYear() - 11;
    expect(where.firstName).toEqual({ equals: 'Minho', mode: 'insensitive' });
    expect(where.schoolDojang).toEqual({ equals: 'Celis TKD', mode: 'insensitive' });
    expect(where.dateOfBirth).toEqual({
      gte: new Date(Date.UTC(birthYear - 1, 0, 1)),
      lt: new Date(Date.UTC(birthYear + 1, 0, 1)),
    });
    // A match updates the record but never overwrites its stored DOB.
    expect(tx.competitor.update.mock.calls[0][0].data.dateOfBirth).toBeUndefined();
    expect(tx.competitor.create).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);
  });

  it('an age-only row with no school matches only competitors without a school', async () => {
    const { tx, prisma } = prismaDouble(null);

    const result = await importFromExcel(prisma, [row({ Age: '11' })], mapping, { matchScope: 'all' });

    expect(tx.competitor.findFirst.mock.calls[0][0].where.schoolDojang).toBeNull();
    expect(tx.competitor.create.mock.calls[0][0].data.dateOfBirth).toEqual(
      new Date(Date.UTC(new Date().getUTCFullYear() - 11, 0, 1)),
    );
    expect(result.imported).toBe(1);
  });
});

describe('importFromExcel — batching and error reporting (D5)', () => {
  it('writes in bounded batches with an explicit transaction timeout', async () => {
    const { prisma } = prismaDouble(null);
    const rows = Array.from({ length: 250 }, (_, i) => row({ First: `F${i}`, DOB: '2014-03-15' }));

    const result = await importFromExcel(prisma, rows, mapping);

    expect(result.imported).toBe(250);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    for (const call of prisma.$transaction.mock.calls) {
      expect(call[1]).toMatchObject({ timeout: expect.any(Number) });
      expect(call[1].timeout).toBeGreaterThan(5000);
    }
  });

  it('a failing row does not roll back its batch; it is reported with its real row number', async () => {
    const { tx, prisma } = prismaDouble(null);
    tx.competitor.create.mockImplementation(async ({ data }: { data: { firstName: string } }) => {
      if (data.firstName === 'Bad') throw new Error('value too long');
      return {};
    });
    const rows = [row({ First: 'Ok1', DOB: '2014-03-15' }), row({ First: 'Bad', DOB: '2014-03-15' }), row({ First: 'Ok2', DOB: '2014-03-15' })];
    // SheetJS tags rows with their 0-based sheet row; header on row 3 here.
    rows.forEach((r, i) => Object.defineProperty(r, '__rowNum__', { value: 3 + i, enumerable: false }));

    const result = await importFromExcel(prisma, rows, mapping);

    expect(result).toMatchObject({ imported: 2, skipped: 1, errors: [{ row: 5, message: 'value too long' }] });
  });

  it('rejects an incomplete mapping and oversized input with 400 AppErrors', async () => {
    const { prisma } = prismaDouble();
    await expect(importFromExcel(prisma, [], { gender: 'G', belt: 'B', weight: 'W' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(importFromExcel(prisma, new Array(5001).fill({}), mapping)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts a combined name column instead of first/last', async () => {
    const { tx, prisma } = prismaDouble(null);
    const result = await importFromExcel(
      prisma,
      [{ Name: 'Yonatan  van Voffin', Gender: 'M', Belt: 'Black', Weight: 175, DOB: '2012-05-06' }],
      { name: 'Name', gender: 'Gender', belt: 'Belt', weight: 'Weight', dateOfBirth: 'DOB' },
    );
    expect(result.imported).toBe(1);
    expect(tx.competitor.create.mock.calls[0][0].data).toMatchObject({ firstName: 'Yonatan', lastName: 'van Voffin' });
  });
});

describe('parseDateOfBirth (D8)', () => {
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('reads YYYY-MM-DD and Excel serials as UTC calendar dates', () => {
    expect(iso(parseDateOfBirth('2012-03-04'))).toBe('2012-03-04T00:00:00.000Z');
    expect(iso(parseDateOfBirth('2012-03-04T00:00:00.000Z'))).toBe('2012-03-04T00:00:00.000Z');
    // 40972 = 2012-03-04 in Excel's 1900 date system
    expect(iso(parseDateOfBirth(40972))).toBe('2012-03-04T00:00:00.000Z');
    expect(iso(parseDateOfBirth(40972.75))).toBe('2012-03-04T00:00:00.000Z');
  });

  it('round-trips the export format (UTC slice of the stored DOB)', () => {
    const stored = new Date(Date.UTC(2015, 0, 1));
    expect(parseDateOfBirth(stored.toISOString().slice(0, 10))?.getTime()).toBe(stored.getTime());
  });

  it('uses MM/DD/YYYY for ambiguous slash dates and DD/MM/YYYY only when unambiguous', () => {
    expect(iso(parseDateOfBirth('03/04/2012'))).toBe('2012-03-04T00:00:00.000Z');
    expect(iso(parseDateOfBirth('25/12/2012'))).toBe('2012-12-25T00:00:00.000Z');
    expect(iso(parseDateOfBirth('12/25/2012'))).toBe('2012-12-25T00:00:00.000Z');
    expect(iso(parseDateOfBirth('3/4/12'))).toBe('2012-03-04T00:00:00.000Z');
    expect(parseDateOfBirth('02/30/2012')).toBeNull();
    expect(parseDateOfBirth('13/13/2012')).toBeNull();
    expect(parseDateOfBirth('not a date')).toBeNull();
  });
});

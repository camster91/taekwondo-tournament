import { describe, expect, it, vi } from 'vitest';
import { importFromExcel } from './excel-import.js';

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

  it('a synthetic Jan-1 DOB derived from an age-only column is never a match key', async () => {
    const { tx, prisma } = prismaDouble();

    const result = await importFromExcel(prisma, [row({ Age: '11' })], mapping, { matchScope: 'all' });

    expect(tx.competitor.findFirst).not.toHaveBeenCalled();
    expect(tx.competitor.update).not.toHaveBeenCalled();
    expect(tx.competitor.create).toHaveBeenCalledOnce();
    expect(result.imported).toBe(1);
  });
});

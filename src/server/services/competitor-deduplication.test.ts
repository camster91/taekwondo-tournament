import { describe, expect, it, vi } from 'vitest';
import {
  clampDuplicateThreshold,
  findPotentialDuplicates,
  MAX_DUPLICATE_CANDIDATES,
  MAX_DUPLICATE_RESULTS,
  MIN_DUPLICATE_THRESHOLD,
} from './competitor-deduplication.js';

const competitor = (id: string, firstName: string, lastName: string, dob: string) => ({
  id, firstName, lastName, dateOfBirth: new Date(dob), gender: 'M', belt: 'Blue',
  beltStripe: null, danRank: null, heightInches: null, weightLbs: null, schoolDojang: null,
  createdAt: new Date(), updatedAt: new Date(), _count: { registrations: 1 },
});

describe('findPotentialDuplicates', () => {
  it('clamps the threshold to a sane minimum', () => {
    expect(clampDuplicateThreshold(0)).toBe(MIN_DUPLICATE_THRESHOLD);
    expect(clampDuplicateThreshold(2)).toBe(1);
    expect(clampDuplicateThreshold(Number.NaN)).toBe(0.75);
  });

  it('passes tenant scope, a narrow select and a candidate cap to Prisma', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const scope = { registrations: { some: { tournament: { organizationId: { in: ['org-1'] } } } } };

    await findPotentialDuplicates({ competitor: { findMany } } as any, 0, { where: scope, maxCandidates: 10_000_000 });

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ AND: [{ deletedAt: null }, scope] });
    expect(args.take).toBe(MAX_DUPLICATE_CANDIDATES);
    expect(args.select.specialNeeds).toBeUndefined();
    expect(args.select.id).toBe(true);
  });

  it('only pairs competitors with DOBs within a day and caps the result count', async () => {
    // 60 near-identical names on one DOB -> 1770 pairs, capped.
    const same = Array.from({ length: 60 }, (_, i) => competitor(`s${i}`, 'Alex', 'Smith', '2014-01-01'));
    const far = competitor('far', 'Alex', 'Smith', '2015-06-01');
    const findMany = vi.fn().mockResolvedValue([...same, far]);

    const result = await findPotentialDuplicates({ competitor: { findMany } } as any, 0.9);

    expect(result.length).toBe(MAX_DUPLICATE_RESULTS);
    expect(result.some((d) => d.competitor1.id === 'far' || d.competitor2.id === 'far')).toBe(false);
  });
});

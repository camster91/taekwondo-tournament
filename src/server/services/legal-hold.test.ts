import { describe, expect, it, vi } from 'vitest';
import { competitorIsHeld, legalHoldData, legalHoldSchema } from './legal-hold.js';

describe('legalHoldSchema', () => {
  it('requires a reason when placing a hold', () => {
    expect(legalHoldSchema.safeParse({ hold: true }).success).toBe(false);
    expect(legalHoldSchema.safeParse({ hold: true, reason: '   ' }).success).toBe(false);
    expect(legalHoldSchema.safeParse({ hold: true, reason: 'Insurance claim 2026-114' }).success).toBe(true);
  });

  it('allows releasing without a reason and caps reason length', () => {
    expect(legalHoldSchema.safeParse({ hold: false }).success).toBe(true);
    expect(legalHoldSchema.safeParse({ hold: true, reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('legalHoldData', () => {
  it('sets or clears both hold fields', () => {
    const now = new Date('2026-09-30T00:00:00.000Z');
    expect(legalHoldData({ hold: true, reason: 'claim' }, now)).toEqual({ legalHoldAt: now, legalHoldReason: 'claim' });
    expect(legalHoldData({ hold: false }, now)).toEqual({ legalHoldAt: null, legalHoldReason: null });
  });
});

describe('competitorIsHeld', () => {
  it('checks the competitor and every tournament it is registered in', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'c1' });
    await expect(competitorIsHeld({ competitor: { findFirst } } as never, 'c1')).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'c1',
        OR: [
          { legalHoldAt: { not: null } },
          { registrations: { some: { tournament: { legalHoldAt: { not: null } } } } },
        ],
      },
      select: { id: true },
    });
    findFirst.mockResolvedValueOnce(null);
    await expect(competitorIsHeld({ competitor: { findFirst } } as never, 'c2')).resolves.toBe(false);
  });
});

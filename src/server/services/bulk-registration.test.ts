import { describe, expect, it } from 'vitest';
import { planBulkRegistration, TOURNAMENT_FULL_SKIP_REASON, type BulkCapacityState } from './bulk-registration.js';

const capacity = (overrides: Partial<BulkCapacityState> = {}): BulkCapacityState => ({
  maxCapacity: null,
  waitlistEnabled: false,
  activeCount: 0,
  maxWaitlistPosition: null,
  ...overrides,
});

const plan = (ids: string[], cap: BulkCapacityState, opts: { existing?: Array<[string, string]>; overCapacity?: boolean } = {}) =>
  planBulkRegistration({
    competitorIds: ids,
    existing: new Map(opts.existing ?? []),
    capacity: cap,
    overCapacity: opts.overCapacity ?? false,
  });

describe('planBulkRegistration', () => {
  it('adds everyone when there is no capacity limit (unchanged behaviour)', () => {
    const result = plan(['a', 'b', 'c'], capacity({ activeCount: 500 }));
    expect(result).toMatchObject({ added: 3, waitlisted: 0, updated: 0, addedOverCapacity: 0, skipped: [] });
    expect(result.entries.every((e) => e.kind === 'create' && e.waitlistStatus === 'active')).toBe(true);
  });

  it('fills free spots first, then the waiting list in pick order', () => {
    const result = plan(['a', 'b', 'c', 'd'], capacity({ maxCapacity: 10, activeCount: 8, waitlistEnabled: true, maxWaitlistPosition: 2 }));
    expect(result).toMatchObject({ added: 2, waitlisted: 2, skipped: [] });
    expect(result.entries).toEqual([
      { kind: 'create', competitorId: 'a', waitlistStatus: 'active', waitlistPosition: null },
      { kind: 'create', competitorId: 'b', waitlistStatus: 'active', waitlistPosition: null },
      { kind: 'create', competitorId: 'c', waitlistStatus: 'waitlisted', waitlistPosition: 3 },
      { kind: 'create', competitorId: 'd', waitlistStatus: 'waitlisted', waitlistPosition: 4 },
    ]);
  });

  it('skips the rest with a reason when full and there is no waiting list', () => {
    const result = plan(['a', 'b', 'c'], capacity({ maxCapacity: 5, activeCount: 4 }));
    expect(result).toMatchObject({ added: 1, waitlisted: 0 });
    expect(result.skipped).toEqual([
      { competitorId: 'b', reason: TOURNAMENT_FULL_SKIP_REASON },
      { competitorId: 'c', reason: TOURNAMENT_FULL_SKIP_REASON },
    ]);
    expect(result.entries).toHaveLength(1);
  });

  it('overCapacity adds everyone as registered and counts the overflow', () => {
    for (const waitlistEnabled of [true, false]) {
      const result = plan(['a', 'b', 'c'], capacity({ maxCapacity: 5, activeCount: 4, waitlistEnabled }), { overCapacity: true });
      expect(result).toMatchObject({ added: 3, waitlisted: 0, addedOverCapacity: 2, skipped: [] });
      expect(result.entries.every((e) => e.kind === 'create' && e.waitlistStatus === 'active')).toBe(true);
    }
  });

  it('overCapacity changes nothing while there is room', () => {
    const result = plan(['a', 'b'], capacity({ maxCapacity: 5, activeCount: 1 }), { overCapacity: true });
    expect(result).toMatchObject({ added: 2, addedOverCapacity: 0 });
  });

  it('existing registrations only get their events updated and never use a spot', () => {
    const result = plan(['a', 'b', 'c'], capacity({ maxCapacity: 3, activeCount: 2 }), { existing: [['a', 'reg-a']] });
    expect(result.entries[0]).toEqual({ kind: 'update', competitorId: 'a', registrationId: 'reg-a' });
    expect(result).toMatchObject({ updated: 1, added: 1 });
    expect(result.skipped.map((s) => s.competitorId)).toEqual(['c']);
  });

  it('ignores repeated ids', () => {
    expect(plan(['a', 'a', 'b'], capacity()).added).toBe(2);
  });
});

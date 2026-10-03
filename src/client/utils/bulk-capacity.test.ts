import { describe, expect, it } from 'vitest';
import { bulkAddSummary, bulkCapacityNotice } from './bulk-capacity';

describe('bulkCapacityNotice', () => {
  it('says nothing without a capacity limit or when everyone fits', () => {
    expect(bulkCapacityNotice(50, null)).toBeNull();
    expect(bulkCapacityNotice(50, { maxCapacity: null, waitlistEnabled: false, spotsRemaining: null })).toBeNull();
    expect(bulkCapacityNotice(3, { maxCapacity: 10, waitlistEnabled: false, spotsRemaining: 3 })).toBeNull();
  });

  it('names how many go to the waiting list', () => {
    expect(bulkCapacityNotice(5, { maxCapacity: 10, waitlistEnabled: true, spotsRemaining: 2 }))
      .toBe('Only 2 spots are left. 3 of these will go to the waiting list.');
    expect(bulkCapacityNotice(3, { maxCapacity: 10, waitlistEnabled: true, spotsRemaining: 0 }))
      .toBe('The tournament is full. All 3 will go to the waiting list.');
  });

  it("names how many won't be added when there is no waiting list", () => {
    expect(bulkCapacityNotice(3, { maxCapacity: 10, waitlistEnabled: false, spotsRemaining: 0 }))
      .toBe("The tournament is full. 3 won't be added.");
    expect(bulkCapacityNotice(4, { maxCapacity: 10, waitlistEnabled: false, spotsRemaining: 1 }))
      .toBe("Only 1 spot is left. 3 won't be added.");
  });
});

describe('bulkAddSummary', () => {
  it('summarises added, waitlisted and skipped counts', () => {
    expect(bulkAddSummary({ added: 2, waitlisted: 3, updated: 0, skippedCount: 0, skipped: [] }, 5))
      .toEqual({ message: 'Added 2 people. 3 on the waiting list.', tone: 'warning' });
    expect(bulkAddSummary({
      added: 1, waitlisted: 0, updated: 0, skippedCount: 2,
      skipped: [{ name: 'A B', reason: 'The tournament is full and has no waiting list' }],
    }, 3)).toEqual({ message: 'Added 1 person. 2 not added: the tournament is full and has no waiting list.', tone: 'warning' });
    expect(bulkAddSummary({ added: 4, addedOverCapacity: 2, waitlisted: 0, skippedCount: 0 }, 4))
      .toEqual({ message: 'Added 4 people. 2 over capacity.', tone: 'success' });
  });

  it('falls back to the requested count for an older response', () => {
    expect(bulkAddSummary({}, 1)).toEqual({ message: 'Added 1 person.', tone: 'success' });
  });
});

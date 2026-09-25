import { describe, expect, it } from 'vitest';
import { CHECK_IN_ACCESSIBLE_LABELS, formatCheckInWeight } from './check-in-display';

describe('check-in weight display', () => {
  it('rounds noisy measured weights to one decimal place', () => {
    expect(formatCheckInWeight(100.95657336793374)).toBe('101.0');
  });

  it('keeps a consistent one-decimal display for whole weights', () => {
    expect(formatCheckInWeight(162)).toBe('162.0');
  });

  it('provides distinct accessible names for navigation and every filter', () => {
    expect(CHECK_IN_ACCESSIBLE_LABELS).toEqual({
      back: 'Back to tournament',
      search: 'Search competitors by name or school',
      status: 'Filter by check-in status',
      event: 'Filter by event',
      school: 'Filter by school',
      sort: 'Sort competitors',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { ageOnDate, formatDateOnly, parseDateOnly } from './date-only';

describe('date-only values', () => {
  it('reads the calendar date from YYYY-MM-DD and UTC-midnight ISO strings', () => {
    expect(parseDateOnly('2010-03-01')).toEqual({ year: 2010, month: 3, day: 1 });
    expect(parseDateOnly('2010-03-01T00:00:00.000Z')).toEqual({ year: 2010, month: 3, day: 1 });
    expect(parseDateOnly(new Date('2010-03-01T00:00:00.000Z'))).toEqual({ year: 2010, month: 3, day: 1 });
  });

  it('rejects empty and invalid input', () => {
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly('2010-02-30')).toBeNull();
    expect(parseDateOnly('not a date')).toBeNull();
    expect(formatDateOnly(undefined)).toBe('');
  });

  it('formats in UTC so the stored day never shifts back a day west of UTC', () => {
    // Would read "2/28/2010" in America/Los_Angeles with a local-time format.
    expect(formatDateOnly('2010-03-01T00:00:00.000Z', {}, 'en-US')).toBe('3/1/2010');
    expect(formatDateOnly('2010-03-01', { year: 'numeric', month: 'short', day: 'numeric' }, 'en-US')).toBe('Mar 1, 2010');
  });

  it('computes age from the calendar date of birth', () => {
    const dayBefore18th = new Date(2026, 2, 31); // local Mar 31 2026
    const on18th = new Date(2026, 3, 1); // local Apr 1 2026
    expect(ageOnDate('2008-04-01', dayBefore18th)).toBe(17);
    expect(ageOnDate('2008-04-01', on18th)).toBe(18);
    expect(ageOnDate('', on18th)).toBeNull();
  });
});

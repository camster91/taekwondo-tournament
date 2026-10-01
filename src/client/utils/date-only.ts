/**
 * Date-only values (dates of birth) are stored as UTC midnight and sent
 * as `YYYY-MM-DD` or a full ISO timestamp. Formatting them with the
 * viewer's local time zone shows the previous day west of UTC, so they
 * are always read from their calendar components instead.
 */

export interface DateOnlyParts {
  year: number;
  month: number; // 1-12
  day: number;
}

const DATE_ONLY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseDateOnly(value: string | Date | null | undefined): DateOnlyParts | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
  }
  const match = DATE_ONLY_PREFIX.exec(value.trim());
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parseDateOnly(parsed);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Format a date-only value without shifting it into the viewer's time zone. */
export function formatDateOnly(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
  locale?: string,
): string {
  const parts = parseDateOnly(value);
  if (!parts) return '';
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    .toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}

/** Whole years between a date of birth and `on` (the viewer's local calendar date). */
export function ageOnDate(dateOfBirth: string | Date | null | undefined, on: Date = new Date()): number | null {
  const dob = parseDateOnly(dateOfBirth);
  if (!dob) return null;
  let age = on.getFullYear() - dob.year;
  const month = on.getMonth() + 1;
  if (month < dob.month || (month === dob.month && on.getDate() < dob.day)) age -= 1;
  return age;
}

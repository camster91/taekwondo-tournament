/**
 * Regression tests for two categorization bugs:
 *
 *  - Black Belt age bands (e.g. "11 and Under") span several weight
 *    tables that all reuse "Light/Middle/Heavy". Grouping by class name
 *    alone mixed a 6-year-old at 66 lb with an 11-year-old at 140 lb.
 *  - "Compete with older" used whole-year age + months/12, so the
 *    default 6-month allowance never promoted anyone and a 12-month
 *    allowance put a 9-year-old in both the 8-9 and the 10-11 band.
 */
import { describe, expect, it } from 'vitest';
import { previewCategorization, resolveAgeBand, ageInMonthsAt, type RegistrationWithCompetitor } from './categorization-engine.js';
import { DEFAULT_AGE_GROUPS } from '../../shared/constants/age-groups.js';

const TOURNAMENT_DATE = '2026-06-01T12:00:00.000Z';

const reg = (id: string, overrides: {
  age: number;
  weight?: number;
  belt?: string;
  sparring?: boolean;
  competeWithOlder?: boolean;
  dateOfBirth?: string;
}): RegistrationWithCompetitor => ({
  id,
  competitorId: `c-${id}`,
  patterns: !overrides.sparring,
  sparring: !!overrides.sparring,
  ageAtTournament: overrides.age,
  weightAtRegistration: overrides.weight ?? null,
  manualDivisionId: null,
  competeWithOlder: overrides.competeWithOlder,
  competitor: {
    firstName: id,
    lastName: 'Test',
    belt: overrides.belt ?? 'Yellow',
    gender: 'M',
    schoolDojang: null,
    weightLbs: overrides.weight ?? null,
    danRank: overrides.belt === 'Black' ? 1 : null,
    dateOfBirth: overrides.dateOfBirth ?? null,
  },
});

const divisionsOf = (preview: ReturnType<typeof previewCategorization>, id: string) =>
  preview.divisions.filter((division) => division.competitors.some((c) => c.registrationId === id));

describe('Black Belt sparring weight classes', () => {
  it('never puts competitors from different weight tables in one division', () => {
    const preview = previewCategorization(
      [
        reg('six', { age: 6, weight: 66, belt: 'Black', sparring: true }),
        reg('eleven', { age: 11, weight: 140, belt: 'Black', sparring: true }),
      ],
      { divisionThreshold: 8, useBlackBeltAgeGroups: true },
    );

    const six = divisionsOf(preview, 'six');
    const eleven = divisionsOf(preview, 'eleven');
    expect(six).toHaveLength(1);
    expect(eleven).toHaveLength(1);
    expect(six[0].name).not.toBe(eleven[0].name);
    expect(six[0].weightClass).toBe('Heavy (6-7)');
    expect(eleven[0].weightClass).toBe('Heavy (10-11)');
  });

  it('keeps the plain class name when a band uses a single weight table', () => {
    const preview = previewCategorization(
      [
        reg('a', { age: 10, weight: 95, sparring: true }),
        reg('b', { age: 11, weight: 100, sparring: true }),
      ],
      { divisionThreshold: 8 },
    );
    expect(preview.divisions).toHaveLength(1);
    expect(preview.divisions[0].weightClass).toBe('Heavy');
  });
});

describe('compete with older', () => {
  const flex6 = { enableAgeBoundaryFlex: true, ageBoundaryTolerance: 6, tournamentDate: TOURNAMENT_DATE };
  const flex12 = { ...flex6, ageBoundaryTolerance: 12 };

  it('computes whole months from date of birth', () => {
    expect(ageInMonthsAt('2016-10-01T12:00:00.000Z', TOURNAMENT_DATE)).toBe(9 * 12 + 8);
    expect(ageInMonthsAt('2016-06-02T12:00:00.000Z', TOURNAMENT_DATE)).toBe(9 * 12 + 11);
    expect(ageInMonthsAt(null, TOURNAMENT_DATE)).toBeNull();
  });

  it('promotes a competitor within the 6-month allowance of the next band', () => {
    // 9 years 8 months: turns 10 four months after the tournament.
    const r = reg('r', { age: 9, competeWithOlder: true, dateOfBirth: '2016-10-01T12:00:00.000Z' });
    expect(resolveAgeBand(r, DEFAULT_AGE_GROUPS, flex6)?.label).toBe('10-11');
  });

  it('does not promote a competitor outside the allowance', () => {
    // 9 years 0 months.
    const r = reg('r', { age: 9, competeWithOlder: true, dateOfBirth: '2017-05-15T12:00:00.000Z' });
    expect(resolveAgeBand(r, DEFAULT_AGE_GROUPS, flex6)?.label).toBe('8-9');
  });

  it('does not promote without the opt-in', () => {
    const r = reg('r', { age: 9, dateOfBirth: '2016-10-01T12:00:00.000Z' });
    expect(resolveAgeBand(r, DEFAULT_AGE_GROUPS, flex6)?.label).toBe('8-9');
  });

  it('places a competitor in exactly one band with a 12-month allowance', () => {
    const preview = previewCategorization(
      [
        reg('nine', { age: 9, competeWithOlder: true, dateOfBirth: '2017-03-01T12:00:00.000Z' }),
        reg('eight', { age: 8 }),
        reg('ten', { age: 10 }),
      ],
      { divisionThreshold: 8, ...flex12 },
    );
    const placed = divisionsOf(preview, 'nine');
    expect(placed).toHaveLength(1);
    expect(placed[0].ageMin).toBe(10);
  });

  it('falls back to the whole-year age when the date of birth is unknown', () => {
    const r = reg('r', { age: 9, competeWithOlder: true });
    expect(resolveAgeBand(r, DEFAULT_AGE_GROUPS, flex6)?.label).toBe('8-9');
    expect(resolveAgeBand(r, DEFAULT_AGE_GROUPS, flex12)?.label).toBe('10-11');
  });
});

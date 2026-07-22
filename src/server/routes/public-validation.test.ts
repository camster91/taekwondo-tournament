/**
 * Tests for the public registration validation helpers.
 *
 * Extracted from public.ts so the field-by-field validation rules
 * (range caps, belt normalization, danRank clearing on belt switch)
 * are testable without spinning up Express + Prisma.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRegistrationPatch,
  validateLookupParams,
  PUBLIC_REGISTRATION_LIMITS,
} from './public-validation.js';

describe('buildRegistrationPatch', () => {
  it('returns empty data + regData for empty body', () => {
    const result = buildRegistrationPatch({});
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({});
    expect(result.regData).toEqual({});
  });

  it('returns empty for undefined body', () => {
    const result = buildRegistrationPatch(undefined);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({});
  });

  it('trims firstName and rejects empty', () => {
    expect(buildRegistrationPatch({ firstName: '  ' }).ok).toBe(false);
    expect(buildRegistrationPatch({ firstName: '' }).ok).toBe(false);
    expect(buildRegistrationPatch({ firstName: '  Minho  ' })).toEqual({
      ok: true,
      data: { firstName: 'Minho' },
      regData: {},
    });
  });

  it('rejects firstName over the cap', () => {
    const long = 'a'.repeat(PUBLIC_REGISTRATION_LIMITS.MAX_FIRST_NAME + 1);
    const result = buildRegistrationPatch({ firstName: long });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/First name must be/);
  });

  it('rejects invalid gender', () => {
    expect(buildRegistrationPatch({ gender: 'X' }).ok).toBe(false);
    expect(buildRegistrationPatch({ gender: 'male' }).ok).toBe(false);
    expect(buildRegistrationPatch({ gender: 'M' })).toEqual({
      ok: true,
      data: { gender: 'M' },
      regData: {},
    });
  });

  it('regression: weight range is 0..500 (was unbounded in PATCH)', () => {
    expect(buildRegistrationPatch({ weight: 0 }).ok).toBe(false);
    expect(buildRegistrationPatch({ weight: -1 }).ok).toBe(false);
    expect(buildRegistrationPatch({ weight: 501 }).ok).toBe(false);
    expect(buildRegistrationPatch({ weight: 'abc' }).ok).toBe(false);
    // The fix in this PR pins the range to match POST /register.
    // Previously, weight = 99999 silently succeeded and broke
    // bracket-by-weight downstream.
    expect(buildRegistrationPatch({ weight: 99999 }).ok).toBe(false);
    expect(buildRegistrationPatch({ weight: 150 })).toEqual({
      ok: true,
      data: {},
      regData: { weightAtRegistration: 150 },
    });
  });

  it('normalizes exact alias match (shared normalizeBelt table)', () => {
    // Belt aliases come from src/shared/constants/belts.ts.
    // "1ST" / "POOM" / etc are NOT belt aliases — they're dan-rank
    // tokens. For multi-token input like "Black 1st Dan", the
    // parent should send "Black" + a separate danRank field.
    expect(buildRegistrationPatch({ belt: 'Black' }).data.belt).toBe('Black');
    expect(buildRegistrationPatch({ belt: 'BLACK' }).data.belt).toBe('Black');
    expect(buildRegistrationPatch({ belt: 'BB' }).data.belt).toBe('Black');
    expect(buildRegistrationPatch({ belt: 'BL' }).data.belt).toBe('Black');
    expect(buildRegistrationPatch({ belt: 'Yellow' }).data.belt).toBe('Yellow');
    expect(buildRegistrationPatch({ belt: 'Y' }).data.belt).toBe('Yellow');
  });

  it('regression: switching off Black clears danRank', () => {
    // The PATCH path should clear danRank when the new belt is not
    // Black. Otherwise a kid changing from Black to Yellow would
    // still be categorized as a high-dan CB.
    const result = buildRegistrationPatch({ belt: 'Yellow' });
    expect(result.data.belt).toBe('Yellow');
    expect(result.data.danRank).toBeNull();
  });

  it('regression: switching to Black with danRank sets danRank', () => {
    const result = buildRegistrationPatch({ belt: 'Black', danRank: 3 });
    expect(result.data.belt).toBe('Black');
    expect(result.data.danRank).toBe(3);
  });

  it('regression: danRank out of range falls back to 1', () => {
    const result = buildRegistrationPatch({ belt: 'Black', danRank: 99 });
    expect(result.data.danRank).toBe(1);
    const result2 = buildRegistrationPatch({ belt: 'Black', danRank: 'banana' });
    expect(result2.data.danRank).toBe(1);
  });

  it('coerces boolean-like fields', () => {
    const result = buildRegistrationPatch({
      patterns: true,
      sparring: false,
      competeWithOlder: true,
    });
    expect(result.regData.patterns).toBe(true);
    expect(result.regData.sparring).toBe(false);
    expect(result.data.competeWithOlder).toBe(true);
  });

  it('coerces patterns truthy strings', () => {
    // Prisma stores booleans; the route normalizes via !!.
    expect(buildRegistrationPatch({ patterns: 'yes' }).regData.patterns).toBe(true);
    expect(buildRegistrationPatch({ patterns: 0 }).regData.patterns).toBe(false);
  });

  it('nullifies empty school', () => {
    expect(buildRegistrationPatch({ school: '' }).data.schoolDojang).toBeNull();
    expect(buildRegistrationPatch({ school: '   ' }).data.schoolDojang).toBeNull();
    expect(buildRegistrationPatch({ school: 'Alpha' }).data.schoolDojang).toBe('Alpha');
  });

  it('rejects school over the cap', () => {
    const long = 'a'.repeat(PUBLIC_REGISTRATION_LIMITS.MAX_SCHOOL + 1);
    expect(buildRegistrationPatch({ school: long }).ok).toBe(false);
  });

  it('rejects specialNeeds over the cap', () => {
    const long = 'a'.repeat(PUBLIC_REGISTRATION_LIMITS.MAX_SPECIAL_NEEDS + 1);
    expect(buildRegistrationPatch({ specialNeeds: long }).ok).toBe(false);
  });

  it('handles a complete realistic body', () => {
    const result = buildRegistrationPatch({
      firstName: 'Minho',
      gender: 'M',
      belt: 'Black',
      danRank: 2,
      school: 'Alpha',
      specialNeeds: 'left knee brace',
      competeWithOlder: true,
      patterns: true,
      sparring: true,
      weight: 145,
    });
    expect(result.ok).toBe(true);
    expect(result.data.firstName).toBe('Minho');
    expect(result.data.gender).toBe('M');
    expect(result.data.belt).toBe('Black');
    expect(result.data.danRank).toBe(2);
    expect(result.data.schoolDojang).toBe('Alpha');
    expect(result.data.specialNeeds).toBe('left knee brace');
    expect(result.data.competeWithOlder).toBe(true);
    expect(result.regData.patterns).toBe(true);
    expect(result.regData.sparring).toBe(true);
    expect(result.regData.weightAtRegistration).toBe(145);
  });
});

describe('validateLookupParams', () => {
  it('accepts a valid lookup', () => {
    expect(validateLookupParams('abc123def', 'Kim', '2015-06-15')).toBeNull();
  });

  it('rejects short confirmation codes (regression: was < 6, kept the same)', () => {
    expect(validateLookupParams('abc12', 'Kim', '2015-06-15')).toMatch(/Confirmation code is required/);
    expect(validateLookupParams('', 'Kim', '2015-06-15')).toMatch(/Confirmation code is required/);
  });

  it('rejects missing lastName', () => {
    expect(validateLookupParams('abc123def', '', '2015-06-15')).toMatch(/Last name is required/);
    expect(validateLookupParams('abc123def', '   ', '2015-06-15')).toMatch(/Last name is required/);
  });

  it('rejects missing DOB', () => {
    expect(validateLookupParams('abc123def', 'Kim', '')).toMatch(/Date of birth is required/);
  });

  it('regression: malformed DOB is now caught at validation (was silently 404)', () => {
    // Previously, `new Date('garbage')` returned Invalid Date and
    // Prisma's `dateOfBirth: new Date('garbage')` quietly matched
    // nothing → 404 "No matching registration found". That's a
    // confusing UX. The new validator catches this and returns a
    // clear 400.
    expect(validateLookupParams('abc123def', 'Kim', 'garbage')).toMatch(/not a valid date/);
    expect(validateLookupParams('abc123def', 'Kim', 'not-a-date')).toMatch(/not a valid date/);
  });

  it('accepts various DOB formats that JS Date can parse', () => {
    expect(validateLookupParams('abc123def', 'Kim', '2015-06-15T00:00:00Z')).toBeNull();
    expect(validateLookupParams('abc123def', 'Kim', 'June 15 2015')).toBeNull();
  });
});

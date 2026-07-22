/**
 * Tests for the shared field validation helpers.
 *
 * Background: PR #103 (public) and PR #106 (invites) each had
 * their own copy of an email regex + length-cap checks. Those are
 * now extracted into this module so the rules stay consistent
 * across the codebase. Tests below pin the contract both routes
 * depend on.
 */

import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validateBoundedString,
  validateRole,
  VALID_ROLES,
  FIELD_LIMITS,
} from './field-validation.js';

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('first.last+tag@subdomain.example.com')).toBeNull();
  });

  it('rejects empty / undefined / null', () => {
    expect(validateEmail('')).toMatch(/required/);
    expect(validateEmail(undefined)).toMatch(/required/);
    expect(validateEmail(null)).toMatch(/required/);
  });

  it('rejects non-string types', () => {
    expect(validateEmail(123)).toMatch(/must be a string/);
    expect(validateEmail(['a@b.c'])).toMatch(/must be a string/);
    expect(validateEmail({})).toMatch(/must be a string/);
  });

  it('rejects malformed emails (was the old behavior — same regex)', () => {
    expect(validateEmail('garbage')).toMatch(/not a valid email/);
    expect(validateEmail('a@b')).toMatch(/not a valid email/);
    expect(validateEmail('@b.com')).toMatch(/not a valid email/);
    expect(validateEmail('user@')).toMatch(/not a valid email/);
    expect(validateEmail('user @b.com')).toMatch(/not a valid email/);
  });

  it('regression: rejects overly long emails (200 char cap)', () => {
    const long = 'a'.repeat(196) + '@b.co';
    expect(validateEmail(long)).toMatch(/200 characters or fewer/);
  });

  it('regression: catches the pre-fix bug ("garbage" was accepted)', () => {
    // The previous code only checked `if (!email)` — so an admin
    // sending an invite with { email: "garbage" } would pass
    // validation and create a broken Invitation row. The fix pins
    // this — garbage is now rejected.
    expect(validateEmail('garbage')).not.toBeNull();
  });
});

describe('validateBoundedString', () => {
  it('accepts within bounds', () => {
    expect(validateBoundedString('hello', 'Name', 10)).toBeNull();
    expect(validateBoundedString('', 'Name', 10, false)).toBeNull();
  });

  it('treats undefined/null as "not provided" by default', () => {
    expect(validateBoundedString(undefined, 'Name', 10)).toBeNull();
    expect(validateBoundedString(null, 'Name', 10)).toBeNull();
  });

  it('rejects undefined when required=true', () => {
    expect(validateBoundedString(undefined, 'Name', 10, true)).toMatch(/required/);
    expect(validateBoundedString(null, 'Name', 10, true)).toMatch(/required/);
  });

  it('rejects non-string types', () => {
    expect(validateBoundedString(123, 'Name', 10)).toMatch(/must be a string/);
    expect(validateBoundedString(true, 'Name', 10)).toMatch(/must be a string/);
  });

  it('rejects strings exceeding the cap', () => {
    const long = 'a'.repeat(101);
    expect(validateBoundedString(long, 'First name', 100)).toMatch(/100 characters or fewer/);
  });

  it('accepts strings exactly at the cap', () => {
    const at = 'a'.repeat(100);
    expect(validateBoundedString(at, 'First name', 100)).toBeNull();
  });

  it('uses the field name in the error message', () => {
    expect(validateBoundedString('x'.repeat(101), 'School', 100)).toMatch(/School must be/);
  });
});

describe('validateRole', () => {
  it('accepts whitelisted roles', () => {
    for (const role of VALID_ROLES) {
      expect(validateRole(role)).toBeNull();
    }
  });

  it('treats undefined / null as "not provided" (use default)', () => {
    expect(validateRole(undefined)).toBeNull();
    expect(validateRole(null)).toBeNull();
  });

  it('rejects unknown role strings', () => {
    expect(validateRole('super-admin')).toMatch(/Invalid role/);
    expect(validateRole('root')).toMatch(/Invalid role/);
    expect(validateRole('')).toMatch(/Invalid role/);
  });

  it('rejects non-string types', () => {
    expect(validateRole(123)).toMatch(/Invalid role/);
    expect(validateRole(['admin'])).toMatch(/Invalid role/);
  });
});

describe('FIELD_LIMITS', () => {
  it('pins the documented limits', () => {
    // Pin the public limits so future drift is caught.
    expect(FIELD_LIMITS.MAX_FIRST_NAME).toBe(100);
    expect(FIELD_LIMITS.MAX_LAST_NAME).toBe(100);
    expect(FIELD_LIMITS.MAX_SCHOOL).toBe(200);
    expect(FIELD_LIMITS.MAX_SPECIAL_NEEDS).toBe(2000);
    expect(FIELD_LIMITS.MAX_WEIGHT_LBS).toBe(500);
  });
});

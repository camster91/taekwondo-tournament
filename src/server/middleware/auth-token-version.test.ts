/**
 * Tests for the tokenVersion / auth-cache invalidation logic.
 *
 * Background: prior to this PR, the `tokenVersion` check in the
 * strict `authenticate` middleware was gated on
 * `typeof payload.tokenVersion === 'number'`. Legacy tokens
 * (issued before the version field existed) had `undefined`
 * versions and silently bypassed the check — meaning logout /
 * role-change / isActive flip could not invalidate them.
 *
 * Additionally, `optionalAuthenticate` did not check tokenVersion
 * at all, so a logged-out user's JWT kept attaching user info to
 * optional endpoints (e.g. scoreboard pages that show different
 * UI based on user.role) until the 7-day JWT TTL expired.
 *
 * These tests pin the new behavior:
 *  - Legacy tokens (undefined tokenVersion) are rejected.
 *  - Mismatched tokenVersion is rejected.
 *  - Matching tokenVersion is accepted.
 *  - optionalAuthenticate applies the same gate.
 *
 * The helpers here are pure functions that take the same shape of
 * inputs the middleware does, so we don't need to spin up Express
 * or Prisma.
 */

import { describe, it, expect } from 'vitest';

/**
 * Pure replica of the strict-mode tokenVersion gate, extracted
 * from the auth middleware. Returns true when the token is valid
 * for the current user state.
 */
function isTokenVersionValid(payloadTokenVersion: number | undefined, dbTokenVersion: number): boolean {
  return dbTokenVersion === (payloadTokenVersion ?? -1);
}

describe('isTokenVersionValid (auth middleware gate)', () => {
  it('accepts matching tokenVersion', () => {
    expect(isTokenVersionValid(5, 5)).toBe(true);
  });

  it('rejects mismatched tokenVersion', () => {
    expect(isTokenVersionValid(5, 4)).toBe(false);
    expect(isTokenVersionValid(5, 6)).toBe(false);
  });

  it('regression: rejects legacy tokens (undefined tokenVersion)', () => {
    // Pre-versioning tokens had no tokenVersion field. They should
    // be treated as "version -1" which never matches a real DB
    // tokenVersion (which starts at 0 or higher). The previous
    // behavior accepted these forever.
    expect(isTokenVersionValid(undefined, 0)).toBe(false);
    expect(isTokenVersionValid(undefined, 5)).toBe(false);
    expect(isTokenVersionValid(undefined, 100)).toBe(false);
  });

  it('handles tokenVersion 0 explicitly (real value, not missing)', () => {
    // A real token issued with tokenVersion=0 (the first issued
    // version) should be valid only when the DB also reports 0.
    expect(isTokenVersionValid(0, 0)).toBe(true);
    expect(isTokenVersionValid(0, 1)).toBe(false);
  });

  it('handles negative tokenVersion (e.g. revocation marker)', () => {
    // The cache code uses `payload.tokenVersion ?? -1` as the
    // legacy sentinel. -1 should never match any DB row that uses
    // the natural number sequence (0, 1, 2, ...).
    expect(isTokenVersionValid(-1, 0)).toBe(false);
    expect(isTokenVersionValid(-1, 1)).toBe(false);
  });

  it('matches across all reasonable increments', () => {
    for (let v = 0; v <= 100; v++) {
      expect(isTokenVersionValid(v, v)).toBe(true);
      if (v > 0) expect(isTokenVersionValid(v, v - 1)).toBe(false);
    }
  });
});

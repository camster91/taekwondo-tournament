/**
 * Tests for the query-string parsing helpers.
 *
 * Background: PR #107 / Phase 12 — numeric query params in
 * competitors.ts were previously parsed with bare parseInt()
 * which silently returns NaN for non-numeric input, then Prisma
 * throws a 500. These helpers make the contract explicit: return
 * a `{ ok: false, error }` for invalid input so the route can
 * surface a clean 400.
 */

import { describe, it, expect } from 'vitest';
import { parseBoundedInt, parseOptionalInt } from './query-parsing.js';

describe('parseBoundedInt', () => {
  it('returns the fallback for missing input', () => {
    expect(parseBoundedInt(undefined, 100)).toEqual({ ok: true, value: 100 });
    expect(parseBoundedInt(null, 100)).toEqual({ ok: true, value: 100 });
    expect(parseBoundedInt('', 100)).toEqual({ ok: true, value: 100 });
  });

  it('parses valid integers', () => {
    expect(parseBoundedInt('50', 100)).toEqual({ ok: true, value: 50 });
    expect(parseBoundedInt(50, 100)).toEqual({ ok: true, value: 50 });
    expect(parseBoundedInt('0', 100)).toEqual({ ok: true, value: 0 });
  });

  it('regression: rejects non-numeric strings (was silently NaN)', () => {
    expect(parseBoundedInt('abc', 100)).toEqual({ ok: false, error: 'must be an integer' });
    expect(parseBoundedInt('50abc', 100)).toEqual({ ok: false, error: 'must be an integer' });
    expect(parseBoundedInt('NaN', 100)).toEqual({ ok: false, error: 'must be an integer' });
  });

  it('regression: rejects floats that parseInt would silently truncate', () => {
    // parseInt('50.5') === 50, which would silently accept invalid input.
    // Number.isInteger rejects it.
    expect(parseBoundedInt('50.5', 100)).toEqual({ ok: false, error: 'must be an integer' });
    expect(parseBoundedInt('1.0', 100)).toEqual({ ok: true, value: 1 });
  });

  it('clamps to min', () => {
    expect(parseBoundedInt('-5', 100, 0)).toEqual({ ok: true, value: 0 });
    expect(parseBoundedInt('-5', 100, -10)).toEqual({ ok: true, value: -5 });
  });

  it('clamps to max', () => {
    expect(parseBoundedInt('5000', 100, 1, 1000)).toEqual({ ok: true, value: 1000 });
    expect(parseBoundedInt('5000', 100, 1)).toEqual({ ok: true, value: 5000 });
  });

  it('handles exact boundary values', () => {
    expect(parseBoundedInt('1', 100, 1, 1000)).toEqual({ ok: true, value: 1 });
    expect(parseBoundedInt('1000', 100, 1, 1000)).toEqual({ ok: true, value: 1000 });
  });

  it('handles very large numbers (capped at MAX_SAFE_INTEGER)', () => {
    // 2^53 is MAX_SAFE_INTEGER + 1, which Number() rounds to 2^53 - 1.
    // The contract is: integer when representable, not arbitrary precision.
    expect(parseBoundedInt('9007199254740991', 100)).toEqual({ ok: true, value: 9007199254740991 });
    expect(parseBoundedInt('9007199254740992', 100)).toEqual({ ok: true, value: 9007199254740991 });
  });
});

describe('parseOptionalInt', () => {
  it('returns undefined for missing/empty input', () => {
    expect(parseOptionalInt(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseOptionalInt(null)).toEqual({ ok: true, value: undefined });
    expect(parseOptionalInt('')).toEqual({ ok: true, value: undefined });
  });

  it('parses valid integers', () => {
    expect(parseOptionalInt('50')).toEqual({ ok: true, value: 50 });
    expect(parseOptionalInt(50)).toEqual({ ok: true, value: 50 });
    expect(parseOptionalInt('-5')).toEqual({ ok: true, value: -5 });
    expect(parseOptionalInt('0')).toEqual({ ok: true, value: 0 });
  });

  it('regression: rejects non-numeric input', () => {
    expect(parseOptionalInt('abc')).toEqual({ ok: false, error: 'must be an integer' });
    expect(parseOptionalInt('50abc')).toEqual({ ok: false, error: 'must be an integer' });
    expect(parseOptionalInt('3.14')).toEqual({ ok: false, error: 'must be an integer' });
  });

  it('handles whitespace (Number() trims, so leading/trailing ws is OK)', () => {
    // Document the actual behavior — Number() ignores surrounding
    // whitespace, so " 50 " parses to 50. We don't trim explicitly
    // so the contract matches what callers expect.
    expect(parseOptionalInt(' 50 ')).toEqual({ ok: true, value: 50 });
  });
});

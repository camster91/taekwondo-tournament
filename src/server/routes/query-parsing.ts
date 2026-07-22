/**
 * Pure query-string parsing helpers.
 *
 * Background: routes that accept numeric query params (limit,
 * offset, weight_min, etc.) previously called parseInt() directly,
 * which returns NaN for non-numeric input — Prisma then throws a
 * 500. These helpers clamp + return undefined for missing or
 * unparseable input so the route can return a clean 400 or
 * silently fall back to defaults.
 */

export interface ParseIntResult {
  ok: boolean;
  value?: number;
  error?: string;
}

/**
 * Parse a query-string value into a bounded integer.
 *
 *   parseBoundedInt('50', 100, 0, 1000) → { ok: true, value: 50 }
 *   parseBoundedInt('abc', 100)         → { ok: false, error: 'must be an integer' }
 *   parseBoundedInt('', 100)            → { ok: true, value: 100 }  // default
 *   parseBoundedInt('5000', 100, 1, 1000) → { ok: true, value: 1000 }  // clamped
 *
 * `undefined` input returns the default with `ok: true`. Empty
 * string is treated like undefined.
 */
export function parseBoundedInt(
  raw: unknown,
  fallback: number,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER
): ParseIntResult {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: fallback };
  }
  const rawStr = String(raw);
  // Strict parse: reject trailing characters that parseInt would
  // silently accept (e.g. "50abc" → 50). Use Number() with a Number.isInteger check.
  const n = Number(rawStr);
  if (!Number.isInteger(n)) {
    return { ok: false, error: 'must be an integer' };
  }
  const bounded = Math.max(min, Math.min(n, max));
  return { ok: true, value: bounded };
}

/**
 * Parse an optional integer query param. Returns the integer when
 * present and valid, undefined when missing or empty, and `{ ok: false }`
 * when present-but-invalid.
 *
 *   parseOptionalInt('50')   → { ok: true, value: 50 }
 *   parseOptionalInt('')     → { ok: true, value: undefined }
 *   parseOptionalInt('abc')  → { ok: false, error: 'must be an integer' }
 */
export function parseOptionalInt(raw: unknown): ParseIntResult {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: undefined };
  }
  const rawStr = String(raw);
  const n = Number(rawStr);
  if (!Number.isInteger(n)) {
    return { ok: false, error: 'must be an integer' };
  }
  return { ok: true, value: n };
}

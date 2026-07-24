import crypto from 'crypto';

/**
 * Hash auth secrets (magic-link tokens/codes, invite tokens) before
 * persisting. Raw values are emailed to the user and never stored.
 */
export function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Lookup helper for dual-read during the cutover window: try the
 * hashed form first (new rows), then plaintext (legacy rows that
 * expire within hours). Prefer hash hits.
 */
export function secretLookupValues(raw: string): string[] {
  const hashed = hashSecret(raw);
  if (hashed === raw) return [hashed];
  return [hashed, raw];
}

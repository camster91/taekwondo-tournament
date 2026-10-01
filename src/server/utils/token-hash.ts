import crypto from 'crypto';

/**
 * Hash auth secrets (magic-link tokens/codes, invite tokens) before
 * persisting. Raw values are emailed to the user and never stored.
 */
export function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Values to match a stored secret against: only the hash. Accepting the raw
 * value as well would let anyone who can read the table (or a backup) submit
 * the stored hash itself as the secret. The plaintext rows from the hashing
 * cutover expired long ago (10 min magic links, 72 h invites).
 */
export function secretLookupValues(raw: string): string[] {
  return [hashSecret(raw)];
}

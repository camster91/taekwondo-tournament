import { createHash, randomBytes } from 'node:crypto';

const MANAGEMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Default TTL for management tokens: 30 days from generation.
// Parents get 1 month to manage their registration; after that, they
// contact the director for a fresh link. Closes #118 acceptance: expiration.
const DEFAULT_TOKEN_TTL_DAYS = 30;

export function generateManagementToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compute the expiry timestamp for a new management token.
 * @param ttlDays Optional TTL in days (defaults to 30)
 * @returns Date object representing when the token should expire
 */
export function getManagementTokenExpiry(ttlDays: number = DEFAULT_TOKEN_TTL_DAYS): Date {
  const now = new Date();
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

export function hashManagementToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidManagementToken(token: string): boolean {
  return MANAGEMENT_TOKEN_PATTERN.test(token);
}

/**
 * Check if a management token is expired or revoked.
 * @param expiresAt Token expiry timestamp from DB (null = never expires, legacy behavior)
 * @param revokedAt Token revocation timestamp from DB (null = not revoked)
 * @returns {valid: false, reason: string} if token is unusable; {valid: true} otherwise
 */
export function validateManagementTokenStatus(
  expiresAt: Date | null,
  revokedAt: Date | null,
): { valid: boolean; reason?: string } {
  // Revoked tokens are immediately invalid, even if not yet expired
  if (revokedAt !== null) {
    return { valid: false, reason: 'revoked' };
  }

  // Expiry check: null expiresAt means legacy token (never expires)
  if (expiresAt !== null && expiresAt < new Date()) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true };
}

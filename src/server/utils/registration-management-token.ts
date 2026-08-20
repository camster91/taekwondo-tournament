import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, Registration } from '@prisma/client';

/**
 * Registration management tokens.
 *
 * A token is a 32-byte (256-bit) cryptographically random secret,
 * base64url-encoded (43 chars). The raw token is shown to the parent
 * exactly once at registration time and (when email is configured) in
 * the confirmation email link. Only the SHA-256 hash of the token is
 * persisted on the Registration row; the raw value is never logged,
 * indexed, or returned by any non-issue code path.
 *
 * The token authorises read/update/withdraw of the parent-facing
 * "Manage Registration" view. It is not a substitute for staff
 * authentication (JWT) and does not grant access to director-only
 * data.
 *
 * Properties:
 *   - 256 bits of entropy (well above the 128-bit acceptance bar)
 *   - Never derived from UUID fragments, names, or other personal facts
 *   - Stored as a hash only; never reversible from the DB
 *   - Scoped to a single Registration row (no cross-registration reuse)
 *   - Optionally expires (default 90 days, see DEFAULT_TOKEN_TTL_DAYS)
 *   - Revocable (managementTokenRevokedAt != null => invalid)
 *   - Every verification attempt is recorded in ManagementTokenAuditLog
 *     with outcome (ok / expired / revoked / malformed / not_found) and
 *     network context (ip, userAgent). The raw token is never written.
 */

const MANAGEMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Default lifetime of a freshly-issued management token. */
export const DEFAULT_TOKEN_TTL_DAYS = 90;

/** Outcome strings written to ManagementTokenAuditLog.outcome. */
export type TokenVerifyOutcome =
  | 'ok'
  | 'expired'
  | 'revoked'
  | 'malformed'
  | 'not_found';

export type TokenAction = 'read' | 'update' | 'withdraw' | 'rotate';

export interface VerifyContext {
  action: TokenAction;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Generate a fresh, unguessable management token. Pure — does not
 * touch the database. Pair with `applyIssuedToken` to persist the
 * hash + expiry on a Registration row.
 */
export function generateManagementToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of the raw token. Deterministic. */
export function hashManagementToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check. Rejects UUID prefixes and other non-tokens. */
export function isValidManagementToken(token: string): boolean {
  return MANAGEMENT_TOKEN_PATTERN.test(token);
}

export interface IssuedToken {
  /** The raw token — show to the parent exactly once, never persist. */
  token: string;
  /** Hash to persist on the Registration row. */
  tokenHash: string;
  /** When the token stops being valid. */
  expiresAt: Date;
}

/**
 * Build a fresh token + hash + expiry triple. Pure — does not touch
 * the database. Use `applyIssuedToken` to persist the resulting hash
 * and expiry on a Registration row.
 */
export function issueManagementToken(
  now: Date = new Date(),
  ttlDays: number = DEFAULT_TOKEN_TTL_DAYS,
): IssuedToken {
  const token = generateManagementToken();
  return {
    token,
    tokenHash: hashManagementToken(token),
    expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000),
  };
}

/**
 * Persist a freshly-issued token on a Registration row. Sets the
 * hash (unique), the expiry, and clears any prior revocation /
 * last-used timestamp so the new token starts in a clean active state.
 */
export async function applyIssuedToken(
  prisma: PrismaClient,
  registrationId: string,
  issued: IssuedToken,
): Promise<void> {
  await prisma.registration.update({
    where: { id: registrationId },
    data: {
      managementTokenHash: issued.tokenHash,
      managementTokenExpiresAt: issued.expiresAt,
      managementTokenRevokedAt: null,
      managementTokenLastUsedAt: null,
    },
  });
}

export interface VerifyResult {
  ok: boolean;
  outcome: TokenVerifyOutcome;
  registration?: Registration;
}

/**
 * Verify a presented management token and return the matching
 * Registration, or null if the token is invalid for any reason. A
 * generic "not ok" return is the only outcome the caller should
 * surface to the network — see the comment in public.ts on the
 * 404-everywhere pattern.
 *
 * Verification is centralised here so the audit log, expiry check,
 * and revocation check cannot drift between the GET, PATCH, DELETE,
 * and (future) rotate handlers.
 *
 * Side effect: writes a ManagementTokenAuditLog row with the outcome,
 * network context, and (where known) registrationId. The raw token is
 * NEVER written.
 *
 * Side effect on success: bumps managementTokenLastUsedAt on the
 * matched Registration row. This is for support / director display
 * only and is not used as an auth signal.
 */
export async function verifyManagementToken(
  prisma: PrismaClient,
  token: string,
  ctx: VerifyContext,
): Promise<VerifyResult> {
  // 1. Format gate. Cheap, no DB hit. Always audited as 'malformed'.
  if (!isValidManagementToken(token)) {
    await prisma.managementTokenAuditLog.create({
      data: {
        registrationId: null,
        action: ctx.action,
        outcome: 'malformed',
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: false, outcome: 'malformed' };
  }

  // 2. Hash lookup. The unique index on managementTokenHash makes
  //    this O(1) for active tokens; revoked tokens stay in the row
  //    so we can still detect them as 'revoked' rather than 'not_found'.
  const tokenHash = hashManagementToken(token);
  const registration = await prisma.registration.findUnique({
    where: { managementTokenHash: tokenHash },
  });

  if (!registration) {
    await prisma.managementTokenAuditLog.create({
      data: {
        registrationId: null,
        action: ctx.action,
        outcome: 'not_found',
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: false, outcome: 'not_found' };
  }

  // 3. Revocation gate.
  if (registration.managementTokenRevokedAt) {
    await prisma.managementTokenAuditLog.create({
      data: {
        registrationId: registration.id,
        action: ctx.action,
        outcome: 'revoked',
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: false, outcome: 'revoked' };
  }

  // 4. Expiry gate. A null expiresAt means "legacy row, never expires"
  //    — these are pre-refactor registrations whose hash was back-filled
  //    but who never had a TTL. They can still self-serve until the
  //    director rotates the token. New tokens always carry an expiry.
  if (
    registration.managementTokenExpiresAt &&
    registration.managementTokenExpiresAt.getTime() <= Date.now()
  ) {
    await prisma.managementTokenAuditLog.create({
      data: {
        registrationId: registration.id,
        action: ctx.action,
        outcome: 'expired',
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: false, outcome: 'expired' };
  }

  // 5. Success. Audit + bump lastUsedAt. We do this in two statements
  //    (rather than a transaction) because the audit log is the source
  //    of truth and we'd rather log a successful verify even if the
  //    lastUsedAt update races. The audit log is also useful even if
  //    the row is later mutated / withdrawn — the verify did happen.
  await prisma.managementTokenAuditLog.create({
    data: {
      registrationId: registration.id,
      action: ctx.action,
      outcome: 'ok',
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });
  await prisma.registration.update({
    where: { id: registration.id },
    data: { managementTokenLastUsedAt: new Date() },
  });

  return { ok: true, outcome: 'ok', registration };
}

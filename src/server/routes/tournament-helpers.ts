/**
 * Pure helpers for tournament-scoped operations.
 *
 * Lives in its own module so the slug-generation + collision-retry
 * logic from POST /api/tournaments/:id/public-slug is unit-testable
 * without spinning up Express + Prisma + the request pipeline.
 */

import crypto from 'crypto';

/**
 * Generate a 16-char base64url slug suitable for the public scoreboard
 * share URL. ~96 bits of entropy. (The original implementation used
 * 10 random bytes → ~13.33 base64url chars; this uses 12 bytes for
 * exactly 16 chars, matching the comment that claimed "16 chars".)
 */
export function generatePublicSlug(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/**
 * Normalize a broadcast email subject for SMTP safety.
 *
 * - Replaces CR/LF (which break the RFC 5322 header) with single space.
 * - Caps length at 998 chars (RFC 5322 limit is 998 + folding; we
 *   keep it simple and avoid SMTP truncation surprises).
 */
export function sanitizeBroadcastSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ').slice(0, 998);
}

/**
 * Apply a Prisma update with collision retry.
 *
 * The slug is unique per tournament in the schema, so a collision
 * would otherwise throw Prisma's P2002. With ~80 bits of entropy this
 * is effectively never going to happen, but a retry loop makes the
 * path explicit and self-healing — and the test below pins the
 * retry budget.
 *
 * `maxAttempts` is exposed as a parameter so tests can use a tiny
 * number (3 in production, 2 in tests for clarity).
 */
export interface SlugUpdateResult {
  ok: boolean;
  attempts: number;
  /** The generated slug, only present when ok=true. */
  slug?: string;
  /** Last error from Prisma, only present when ok=false. */
  lastError?: unknown;
}

export interface PrismaUpdateOp<T> {
  /** Generate the slug for this attempt. */
  makeSlug: () => string;
  /** Issue the update. Should throw on collision (P2002). */
  update: (slug: string) => Promise<T>;
  /** Detect P2002 on a thrown error. */
  isP2002: (error: unknown) => boolean;
  /** Maximum number of attempts before giving up. */
  maxAttempts?: number;
}

export async function applySlugWithRetry<T>(op: PrismaUpdateOp<T>): Promise<T & { slug: string; attempts: number }> {
  const maxAttempts = op.maxAttempts ?? 3;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = op.makeSlug();
    try {
      const result = await op.update(slug);
      return Object.assign(result as object, { slug, attempts: attempt + 1 }) as T & { slug: string; attempts: number };
    } catch (error: unknown) {
      lastError = error;
      if (op.isP2002(error)) {
        continue;
      }
      throw error;
    }
  }
  // Re-throw the last collision error verbatim so callers (and tests)
  // can inspect it. Don't wrap — Prisma's P2002 shape is the diagnostic
  // signal.
  throw lastError;
}

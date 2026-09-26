import { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import { createRateLimiter } from './rate-limit.js';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Rate limits for the bracket write path.
 *
 * Every bracket write (match result, swap, undo, reset, generate,
 * correction) takes a row lock on the bracket, rewrites Match rows and
 * appends MatchAuditLog entries. Without a cap, a compromised
 * scorekeeper/director session (or a runaway client retry loop) can
 * flood the audit log and starve other rings of the bracket lock.
 *
 * The limiters are mounted per-route AFTER `authenticate`, so they key
 * on the authenticated user: several scorekeepers behind one venue NAT
 * each get their own budget. The IP fallback (IPv6-subnet aware via
 * `ipKeyGenerator`) only applies if a limiter is ever mounted before
 * authentication.
 *
 * Both limiters go through `createRateLimiter`, so they are bypassed
 * under vitest / Playwright / `RATE_LIMIT_DISABLED=1` outside
 * production, exactly like the auth and public limiters.
 */

/** Match-level writes: result entry, swap, undo, video link, previews. */
export const BRACKET_WRITE_WINDOW_MS = 60_000;
export const BRACKET_WRITE_MAX = 120;

/** Whole-bracket rewrites: generate, generate-all, reset, correction apply/undo. */
export const BRACKET_REBUILD_WINDOW_MS = 60_000;
export const BRACKET_REBUILD_MAX = 20;

export function bracketRateLimitKey(req: { ip?: string }): string {
  const userId = (req as Pick<AuthenticatedRequest, 'user'>).user?.id;
  if (userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

export function createBracketWriteLimiter(): RateLimitRequestHandler {
  return createRateLimiter({
    windowMs: BRACKET_WRITE_WINDOW_MS,
    limit: BRACKET_WRITE_MAX,
    keyGenerator: (req) => bracketRateLimitKey(req as { ip?: string }),
    message: { error: 'Too many bracket updates. Please wait a moment and try again.' },
  });
}

export function createBracketRebuildLimiter(): RateLimitRequestHandler {
  return createRateLimiter({
    windowMs: BRACKET_REBUILD_WINDOW_MS,
    limit: BRACKET_REBUILD_MAX,
    keyGenerator: (req) => bracketRateLimitKey(req as { ip?: string }),
    message: { error: 'Too many bracket rebuilds. Please wait a minute and try again.' },
  });
}

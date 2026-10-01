/**
 * Large JSON body routes (Excel auto-map / import, organization logo upload).
 *
 * Body-parser only parses a request once, so a route that needs a bigger
 * limit than the global 1 MB parser must be parsed BEFORE the global parser
 * runs — a route-level parser inside the router is too late (the global
 * parser has already rejected the request with 413).
 *
 * Security ordering: rate limit → authenticate → role check → 40 MB parser.
 * An anonymous or low-privilege caller is rejected before the server buffers
 * and JSON-parses a 40 MB body. The routers repeat authenticate/requireRole;
 * that is cheap (cached user) and keeps them safe if mounted elsewhere.
 *
 * Requires cookie-parser to run first (authenticate reads the session cookie).
 */
import express from 'express';
import { authenticate, requireRole } from './auth.js';
import { createRateLimiter } from './rate-limit.js';

export const LARGE_JSON_BODY_ROUTES = ['/api/competitors/auto-map', '/api/competitors/import'] as const;
export const LARGE_JSON_BODY_LIMIT = '40mb';

/**
 * Organization logo upload (base64 JSON). The route caps the decoded image
 * at 2 MB; base64 inflates that ~4/3 (≈2.7 MB) plus the JSON envelope, so
 * the global 1 MB parser would reject every logo over ~750 KB with 413.
 */
export const LOGO_JSON_BODY_ROUTES = ['/api/organizations/:orgId/logo-base64'] as const;
export const LOGO_JSON_BODY_LIMIT = '3mb';

export function mountLargeJsonBodyRoutes(app: ReturnType<typeof express>): void {
  const largeBodyLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many upload requests. Please try again later.' },
  });
  app.post(
    [...LARGE_JSON_BODY_ROUTES],
    largeBodyLimiter,
    authenticate,
    requireRole('admin', 'director'),
    express.json({ limit: LARGE_JSON_BODY_LIMIT }),
  );
  app.post(
    [...LOGO_JSON_BODY_ROUTES],
    largeBodyLimiter,
    authenticate,
    requireRole('admin', 'director'),
    express.json({ limit: LOGO_JSON_BODY_LIMIT }),
  );
}

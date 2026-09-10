/**
 * Error tracking initialization for server-side (Sentry SDK).
 *
 * Works with both Sentry.io and GlitchTip (self-hosted, Sentry-compatible).
 * Gated by SENTRY_DSN env var — when unset, all Sentry calls become no-ops.
 * Use SENTRY_DSN to enable; set SENTRY_ENVIRONMENT to distinguish dev/staging/prod.
 *
 * Captures:
 *  - Uncaught exceptions and unhandled rejections
 *  - Express request context (user, transaction name, HTTP details)
 *  - Breadcrumbs (console logs, HTTP requests, DB queries)
 *  - User context when available (from req.user)
 */

import * as Sentry from '@sentry/node';
import type express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';

type ExpressApp = ReturnType<typeof express>;

/** Headers that must never reach Sentry/GlitchTip. Lowercased. */
const SENSITIVE_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'x-csrf-token',
  'x-api-key',
]);

const REDACTED = '[REDACTED]';

/**
 * Mutate and return a Sentry event with PII fields stripped.
 *
 * Why this is exported: the same redaction logic is used in `beforeSend`
 * (errors, messages) and exercised in the unit tests below. The test
 * passes synthetic event shapes, runs the function, and asserts the
 * redacted result.
 *
 * Coverage:
 *  - `event.user.email` / `event.user.username` — replaced with [REDACTED]
 *  - `event.user.ip_address` — last two IPv4 octets masked; last three
 *    IPv6 groups masked
 *  - `event.request.headers` — cookie / set-cookie / authorization /
 *    x-csrf-token / x-api-key replaced with [REDACTED]
 *  - `event.request.data` — replaced with [REDACTED] (request body
 *    can carry magic-link tokens, profile names, payment fields)
 *  - `event.request.query_string` — replaced with [REDACTED] (URL
 *    parameters may carry `token=…` for magic links / invites)
 *  - any `event.contexts[*].email` — replaced with [REDACTED] (covers
 *    `Sentry.withScope({ setContext('user', { email }) })`)
 */
export function redactSentryEvent(event: {
  user?: { email?: string; username?: string; ip_address?: unknown };
  request?: {
    headers?: Record<string, unknown>;
    data?: unknown;
    query_string?: unknown;
  };
  contexts?: Record<string, unknown>;
}): typeof event {
  if (event.user) {
    if (event.user.email) event.user.email = REDACTED;
    if (event.user.username) event.user.username = REDACTED;
    if (event.user.ip_address) {
      const ip = event.user.ip_address as unknown;
      if (typeof ip === 'string' && ip.includes('.') && !ip.includes(':')) {
        event.user.ip_address = ip.replace(/\.\d+\.\d+$/, `.${REDACTED}`);
      } else if (typeof ip === 'string' && ip.includes(':')) {
        event.user.ip_address = `${ip.split(':').slice(0, 3).join(':')}::${REDACTED}`;
      }
    }
  }
  if (event.request) {
    if (event.request.headers) {
      const headers = event.request.headers as Record<string, unknown>;
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
          headers[key] = REDACTED;
        }
      }
    }
    if (event.request.data !== undefined) {
      event.request.data = REDACTED;
    }
    if (event.request.query_string !== undefined && typeof event.request.query_string === 'string') {
      event.request.query_string = REDACTED;
    }
  }
  if (event.contexts) {
    for (const ctxKey of Object.keys(event.contexts)) {
      const ctx = event.contexts[ctxKey] as Record<string, unknown> | undefined;
      if (ctx && typeof ctx === 'object' && 'email' in ctx) {
        ctx.email = REDACTED;
      }
    }
  }
  return event;
}

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

/**
 * Initialize Sentry for the Express app. Call this BEFORE any routes are mounted.
 * No-op when SENTRY_DSN is unset.
 */
export function initSentry(app: ExpressApp): void {
  if (!SENTRY_DSN) {
    console.info('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    integrations: [
      // Enable HTTP instrumentation
      Sentry.httpIntegration(),
      // Enable Express instrumentation (v10 signature: no options)
      Sentry.expressIntegration(),
    ],
    // Performance monitoring — sample 10% of transactions in production, 100% in dev
    tracesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
    // Scrub PII from error/capture events. mountSentryRequestHandler
    // below attaches `Sentry.setUser({ id, email, role })` to every
    // request, and Sentry v10's httpIntegration captures the full
    // request body / query string into the event. Without this hook
    // every exception ships the user's email plus the request
    // payload to Sentry/GlitchTip — under GDPR / PIPEDA that's
    // data the user never consented to sending.
    beforeSend(event) {
      return redactSentryEvent(event as Parameters<typeof redactSentryEvent>[0]) as typeof event;
    },
    // Don't send PII (emails, names, etc.) in breadcrumbs or transactions
    beforeBreadcrumb(breadcrumb, hint) {
      // Strip sensitive headers
      if (breadcrumb.category === 'http' && breadcrumb.data?.headers) {
        delete breadcrumb.data.headers.authorization;
        delete breadcrumb.data.headers.cookie;
      }
      return breadcrumb;
    },
    beforeSendTransaction(event) {
      // Scrub URLs that may contain PII or capability tokens
      if (event.transaction) {
        // Redact query params from public child-lookup endpoints
        event.transaction = event.transaction.replace(
          /\/api\/public\/check-registration\?.*$/,
          '/api/public/check-registration?[REDACTED]'
        );
        // Redact magic-link tokens
        event.transaction = event.transaction.replace(
          /\/verify\?token=[^&\s]+/g,
          '/verify?token=[REDACTED]'
        );
        // Redact invite tokens
        event.transaction = event.transaction.replace(
          /\/accept-invite\?token=[^&\s]+/g,
          '/accept-invite?token=[REDACTED]'
        );
        // Redact public scoreboard slugs (capability tokens)
        event.transaction = event.transaction.replace(
          /\/api\/public\/scoreboard\/[a-zA-Z0-9_-]{16,}/,
          '/api/public/scoreboard/[SLUG]'
        );
        event.transaction = event.transaction.replace(
          /\/display\/[a-zA-Z0-9_-]{16,}/,
          '/display/[SLUG]'
        );
      }
      // Scrub request.url if present
      if (event.request?.url) {
        const url = new URL(event.request.url);
        // Redact all query params from public check-registration
        if (url.pathname === '/api/public/check-registration') {
          url.search = '';
          event.request.url = url.toString();
          event.request.query_string = '[REDACTED]';
        }
        // Redact token query params
        if (url.searchParams.has('token')) {
          url.searchParams.set('token', '[REDACTED]');
          event.request.url = url.toString();
        }
        // Redact public scoreboard slugs in path
        if (url.pathname.match(/\/api\/public\/scoreboard\/[a-zA-Z0-9_-]{16,}/)) {
          event.request.url = event.request.url.replace(
            /\/api\/public\/scoreboard\/[a-zA-Z0-9_-]{16,}/,
            '/api/public/scoreboard/[SLUG]'
          );
        }
      }
      return event;
    },
  });

  console.info(`[sentry] Initialized (env: ${SENTRY_ENVIRONMENT}, DSN: ${SENTRY_DSN.substring(0, 20)}...)`);
}

/**
 * Mount Sentry request middleware. Call this AFTER initSentry and BEFORE your routes.
 * No-op when SENTRY_DSN is unset.
 * 
 * In Sentry v10, requestHandler/tracingHandler are deprecated. Context and tracing
 * are handled automatically by the expressIntegration in Sentry.init().
 */
export function mountSentryRequestHandler(app: ExpressApp): void {
  if (!SENTRY_DSN) return;

  // Attach user context from req.user (set by authenticate middleware)
  // This is the only manual middleware needed in v10 - everything else is automatic
  app.use((req: Request & { user?: { id: string; email: string; role: string } }, _res: Response, next: NextFunction) => {
    if (req.user) {
      Sentry.setUser({
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      });
    }
    next();
  });
}

/**
 * Mount Sentry error handler. Call this AFTER all routes and BEFORE your own error handler.
 * No-op when SENTRY_DSN is unset.
 * 
 * In Sentry v10, use setupExpressErrorHandler instead of errorHandler().
 */
export function mountSentryErrorHandler(app: ExpressApp): void {
  if (!SENTRY_DSN) return;

  // Sentry v10: setupExpressErrorHandler replaces errorHandler()
  Sentry.setupExpressErrorHandler(app);
}

/**
 * Capture an exception manually. Useful for caught errors you want to report.
 * No-op when SENTRY_DSN is unset.
 */
export function captureException(error: Error, context?: Record<string, any>): void {
  if (!SENTRY_DSN) return;

  if (context) {
    Sentry.withScope((scope) => {
      scope.setContext('custom', context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Add a breadcrumb manually. Useful for tracking custom events.
 * No-op when SENTRY_DSN is unset.
 */
export function addBreadcrumb(message: string, category: string, data?: Record<string, any>): void {
  if (!SENTRY_DSN) return;

  Sentry.addBreadcrumb({
    message,
    category,
    level: 'info',
    data,
  });
}

/**
 * Set user context. Useful when user info is available outside of a request.
 * No-op when SENTRY_DSN is unset.
 */
export function setUser(user: { id: string; email: string; role?: string }): void {
  if (!SENTRY_DSN) return;

  Sentry.setUser(user);
}

/**
 * Clear user context (e.g., on logout).
 * No-op when SENTRY_DSN is unset.
 */
export function clearUser(): void {
  if (!SENTRY_DSN) return;

  Sentry.setUser(null);
}

/**
 * Check if Sentry is enabled.
 */
export function isSentryEnabled(): boolean {
  return !!SENTRY_DSN;
}

/**
 * Sentry initialization for server-side error tracking and performance monitoring.
 *
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
import type { Express, Request, Response, NextFunction } from 'express';

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

/**
 * Initialize Sentry for the Express app. Call this BEFORE any routes are mounted.
 * No-op when SENTRY_DSN is unset.
 */
export function initSentry(app: Express): void {
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
export function mountSentryRequestHandler(app: Express): void {
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
export function mountSentryErrorHandler(app: Express): void {
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

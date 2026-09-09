/**
 * Sentry initialization for client-side error tracking.
 *
 * Gated by VITE_SENTRY_DSN env var — when unset, all Sentry calls become no-ops.
 * Use VITE_SENTRY_DSN to enable; set VITE_SENTRY_ENVIRONMENT to distinguish dev/staging/prod.
 *
 * Captures:
 *  - Uncaught exceptions and unhandled promise rejections
 *  - React component errors (via ErrorBoundary)
 *  - User interactions (clicks, navigation)
 *  - User context when available (from AuthContext)
 */

import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const SENTRY_ENVIRONMENT = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development';

/**
 * Initialize Sentry for the React app. Call this BEFORE ReactDOM.render.
 * No-op when VITE_SENTRY_DSN is unset.
 */
export function initSentry(): void {
  if (!SENTRY_DSN) {
    console.info('[sentry] VITE_SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    integrations: [
      // Browser tracing for performance monitoring
      Sentry.browserTracingIntegration(),
      // Replay sessions for debugging (10% sample rate in production, 100% on errors)
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Performance monitoring — sample 10% of transactions in production, 100% in dev
    tracesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
    // Session replay — sample 10% of sessions, 100% of error sessions
    replaysSessionSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
    // Don't send PII in breadcrumbs by default
    beforeBreadcrumb(breadcrumb, hint) {
      // Strip localStorage/sessionStorage values
      if (breadcrumb.category === 'console' && breadcrumb.message) {
        breadcrumb.message = breadcrumb.message.replace(/bowin_auth_token=[^&\s]+/g, 'bowin_auth_token=***');
      }
      return breadcrumb;
    },
  });

  console.info(`[sentry] Initialized (env: ${SENTRY_ENVIRONMENT}, DSN: ${SENTRY_DSN.substring(0, 20)}...)`);
}

/**
 * Capture an exception manually. Useful for caught errors you want to report.
 * No-op when VITE_SENTRY_DSN is unset.
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
 * No-op when VITE_SENTRY_DSN is unset.
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
 * Set user context. Call this after successful login.
 * No-op when VITE_SENTRY_DSN is unset.
 */
export function setUser(user: { id: string; email: string; role?: string }): void {
  if (!SENTRY_DSN) return;

  Sentry.setUser(user);
}

/**
 * Clear user context. Call this on logout.
 * No-op when VITE_SENTRY_DSN is unset.
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

/**
 * ErrorBoundary component for React. Wrap your app with this to catch component errors.
 * No-op fallback when VITE_SENTRY_DSN is unset.
 */
export const ErrorBoundary = SENTRY_DSN
  ? Sentry.ErrorBoundary
  : ({ children }: { children: React.ReactNode }) => <>{children}</>;

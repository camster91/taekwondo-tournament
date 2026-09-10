/**
 * Product analytics initialization for client-side (PostHog).
 *
 * Bowin serves youth tournament data (minors are common registrants),
 * so analytics are opt-in via env vars and default to the most
 * privacy-respecting configuration. PostHog is recommended over
 * Google Analytics because it is:
 *   - Self-hostable (EU / on-prem) for data-residency requirements
 *   - GDPR-friendly by default (no IP capture, no cookies-by-default)
 *   - Capable of running without cross-site tracking identifiers
 *
 * Gated by VITE_POSTHOG_KEY env var. When unset, all PostHog calls
 * become no-ops. Use VITE_POSTHOG_HOST to point at a self-hosted
 * or EU instance (e.g. https://eu.i.posthog.com). The default host
 * is PostHog's US cloud.
 *
 * Privacy posture (defaults):
 *   - Session recording DISABLED. Replays would capture every field,
 *     including the scorekeeper screen showing competitor names.
 *   - IP address NOT captured. PostHog still derives city/country from
 *     the request, but we opt out of the IP-storage field.
 *   - person_profiles = "identified_only": no anonymous profile is
 *     created until identify() is called with a real user id.
 *   - autocapture is on (clicks / form submits), but competitor name
 *     fields are masked via `mask_all_text` so a click is captured
 *     without leaking the value.
 *   - Page views captured automatically; route changes announce
 *     `$current_url` only (no query string with magic-link tokens).
 */

import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST =
  import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
const POSTHOG_ENVIRONMENT =
  import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development';

/**
 * Initialize PostHog for the React app. Call this BEFORE ReactDOM.render
 * so the first page view is captured. No-op when VITE_POSTHOG_KEY is unset.
 */
export function initPostHog(): void {
  if (!POSTHOG_KEY) {
    console.info('[posthog] VITE_POSTHOG_KEY not set — analytics disabled');
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Capture page views + page leaves automatically. $current_url is
    // recorded but we mask query strings below to avoid leaking tokens.
    capture_pageview: true,
    capture_pageleave: true,
    // Privacy posture: see file header for rationale.
    disable_session_recording: true,
    person_profiles: 'identified_only',
    ip: false,
    mask_all_text: true,
    // Strip query strings (e.g. ?token=... on /verify) from the captured
    // $current_url so a leaked event does not expose a magic-link token.
    sanitize_properties: (properties) => {
      if (properties && typeof properties === 'object') {
        const sanitized = { ...(properties as Record<string, unknown>) };
        const currentUrl = sanitized.$current_url;
        if (typeof currentUrl === 'string') {
          try {
            const parsed = new URL(currentUrl, 'http://placeholder.invalid');
            parsed.search = '';
            parsed.hash = '';
            sanitized.$current_url = parsed.pathname;
          } catch {
            sanitized.$current_url = currentUrl.split('?')[0]?.split('#')[0] ?? currentUrl;
          }
        }
        return sanitized;
      }
      return properties;
    },
  });

  // Tag every event with the environment so the dashboard can split
  // dev / staging / production. Mirrors the Sentry pattern.
  posthog.register({ environment: POSTHOG_ENVIRONMENT });

  console.info(
    `[posthog] Initialized (host: ${POSTHOG_HOST}, env: ${POSTHOG_ENVIRONMENT})`,
  );
}

/**
 * Check if PostHog is enabled (VITE_POSTHOG_KEY is set).
 */
export function isPostHogEnabled(): boolean {
  return Boolean(POSTHOG_KEY);
}

/**
 * Re-export the posthog-js default export so callers can capture
 * events / identify users without a second import. The module is
 * still safe to import when PostHog is disabled — the SDK is loaded
 * eagerly (it is < 30KB gzipped and only initializes when a key is
 * present at runtime).
 */
export { posthog };

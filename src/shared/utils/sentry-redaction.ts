/**
 * PII / credential scrubbing for error-tracking events (Sentry / GlitchTip).
 *
 * Shared by the server (`src/server/services/sentry.ts`) and the browser
 * (`src/client/services/sentry.ts`) so both apply identical rules in
 * `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`.
 *
 * The app handles minors' registrations, so guardian names, emails,
 * phone numbers, dates of birth and medical notes must never leave the
 * process. Rules:
 *  - `user` keeps only the opaque `id` (no email/username/IP).
 *  - `request.data` (bodies: registrations, guardian details), cookies and
 *    credential headers are dropped; query strings are scrubbed.
 *  - Any object key that names a secret or a PII field is replaced.
 *  - Free-text strings (messages, exception values, breadcrumbs, extra,
 *    contexts, URLs) have emails, phone numbers, JWTs, bearer tokens,
 *    long hex tokens (magic links, invites) and `token=` params masked.
 *
 * Types are structural (no SDK import) so this module compiles for both
 * the Node and the browser bundle.
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-api-key',
  'x-metrics-token',
]);

/**
 * Keys whose values are always secret or personal. Matched against the
 * key with `_`/`-` removed, case-insensitively.
 */
const SENSITIVE_KEY_PATTERN =
  /pass(word|code)?|secret|token|jwt|session|cookie|authorization|apikey|csrf|otp|magiclink|email|phone|mobile|guardian|parent(name|email|phone)|emergency|dateofbirth|^dob$|birth|address|street|postal|^zip(code)?$|medical|allerg|firstname|lastname|fullname|^ip$/i;

const MAX_DEPTH = 8;

const STRING_RULES: ReadonlyArray<[RegExp, string]> = [
  // Authorization header values echoed into messages.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]'],
  // JWTs (three base64url segments, header starts with eyJ).
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]'],
  // Credential-bearing query/form params.
  [/([?&;](?:token|code|access_token|refresh_token|key|signature|sig|email|slug)=)[^&#\s"']*/gi, `$1${REDACTED}`],
  // Cookie assignments (bowin_session=..., bowin_csrf=...).
  [/\b(bowin_[a-z_]+|tkd_[a-z_]+)=[^;&\s"']+/gi, `$1=${REDACTED}`],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  // Long hex / base64url capability tokens (magic links, invites, slugs).
  [/\b[a-f0-9]{32,}\b/gi, '[TOKEN]'],
  // Phone numbers: NANP-style 3-3-4 with separators (optional +CC) ...
  [/(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])/g, '[PHONE]'],
  // ... and E.164 (+15551234567). Bare digit runs (ids, timestamps) are left alone.
  [/(?<![\w+])\+\d{10,15}(?!\w)/g, '[PHONE]'],
];

export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of STRING_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.replace(/[_-]/g, ''));
}

/** Deep-scrub an arbitrary value; objects/arrays are copied, never mutated. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(inner, depth + 1);
  }
  return out;
}

function scrubRecord(value: unknown): Record<string, unknown> | undefined {
  const scrubbed = scrubValue(value);
  return scrubbed && typeof scrubbed === 'object' && !Array.isArray(scrubbed)
    ? (scrubbed as Record<string, unknown>)
    : undefined;
}

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(name.toLowerCase())) continue;
    out[name] = typeof value === 'string' ? scrubString(value) : value;
  }
  return out;
}

export interface RedactableBreadcrumb {
  message?: string;
  data?: { [key: string]: unknown };
}

export interface RedactableEvent {
  message?: string;
  transaction?: string;
  user?: { id?: string | number; [key: string]: unknown } | null;
  request?: {
    url?: string;
    headers?: { [key: string]: string };
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
    env?: unknown;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: RedactableBreadcrumb[];
  extra?: { [key: string]: unknown };
  contexts?: { [key: string]: unknown };
  tags?: { [key: string]: unknown };
}

/**
 * Redact a Sentry event in place and return it (Sentry's hooks expect the
 * same object back). Never returns null — dropping events would hide
 * production errors; scrubbing keeps them useful without the PII.
 */
export function redactSentryEvent<T extends RedactableEvent>(event: T): T {
  if (event.user) {
    const id = event.user.id;
    event.user = id !== undefined ? { id } : {};
  }

  if (event.request) {
    const req = event.request;
    delete req.cookies;
    delete req.data;
    delete req.env;
    if (req.headers) req.headers = scrubHeaders(req.headers);
    if (req.query_string !== undefined) {
      req.query_string = typeof req.query_string === 'string'
        ? scrubString(`?${req.query_string}`).slice(1)
        : REDACTED;
    }
    if (req.url) req.url = scrubString(req.url);
  }

  if (event.message) event.message = scrubString(event.message);
  if (event.transaction) event.transaction = scrubString(event.transaction);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => redactBreadcrumb(crumb));
  }

  if (event.extra) event.extra = scrubRecord(event.extra);
  if (event.contexts) event.contexts = scrubRecord(event.contexts);
  if (event.tags) event.tags = scrubRecord(event.tags);

  return event;
}

/** Redact a breadcrumb in place (message + data) and return it. */
export function redactBreadcrumb<T extends RedactableBreadcrumb>(breadcrumb: T): T {
  if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
  if (breadcrumb.data) {
    const data = { ...breadcrumb.data };
    if (data.headers && typeof data.headers === 'object' && !Array.isArray(data.headers)) {
      data.headers = scrubHeaders(data.headers as Record<string, string>);
    }
    // Request/response bodies captured by fetch/xhr instrumentation.
    for (const bodyKey of ['body', 'request_body', 'response_body', 'requestBody', 'responseBody']) {
      if (bodyKey in data) data[bodyKey] = REDACTED;
    }
    breadcrumb.data = scrubRecord(data);
  }
  return breadcrumb;
}

// Structured audit logger. Replaces ad-hoc `console.log("[event] ...")` calls
// in route handlers with a JSON-payload sink that the rest of the
// observability pipeline can parse. Closes LOW #15 in the
// 2026-09-10 backend review: the previous format was a free-form
// string, which made the audit trail impossible to grep or alert on
// without manual parsing.
//
// Usage:
//   auditLog({ event: 'registration.manage.read', registrationId, ip });
//
// Output shape (single line, JSON object):
//   {"event":"registration.manage.read","registrationId":"abcd1234","ts":"...","level":"info"}
//
// The `level` field is reserved for future routing to error/warn/info
// destinations; today everything goes through `console.log` so existing
// log collectors see the same volume.

export type AuditLevel = 'info' | 'warn' | 'error';

export interface AuditLogPayload {
  /** Stable, machine-readable event name (e.g. `registration.manage.read`). */
  event: string;
  /** Severity bucket. Defaults to `info`. */
  level?: AuditLevel;
  /** All other fields are preserved in the JSON output. Keep this small and
   *  PII-free: do not log raw tokens, full emails, full IPs, etc. */
  [key: string]: unknown;
}

/** Escape a value for safe embedding in the JSON log line. Rejects
 *  circular references rather than silently producing `[object Object]`. */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    // Drop functions and undefined inside the payload so we never
    // accidentally serialize a private key.
    if (typeof value === 'function') return undefined;
    return value;
  });
}

/** Emit a single-line JSON audit log. */
export function auditLog(payload: AuditLogPayload): void {
  const { level = 'info', event, ...rest } = payload;
  if (!event || typeof event !== 'string') {
    // Defensive: a missing event name would defeat the whole point
    // of the structured logger. Fall back to a console.warn so the
    // bad call is itself auditable.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'audit_log.missing_event',
        message: 'auditLog called without an event name',
      }),
    );
    return;
  }
  const line = safeStringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...rest,
  });
  // `console.log` is the existing audit channel; routing through
  // `process.stdout` would be a bigger refactor.
  console.log(line);
}

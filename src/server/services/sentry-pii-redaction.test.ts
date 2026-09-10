/**
 * Unit test for the Sentry `beforeSend` PII scrubber.
 *
 * Track-1 cross-track pattern (00-summary.md, "PII through the cracks"):
 *   Sentry events include user email (no `beforeSend` scrubber). The
 *   `mountSentryRequestHandler` middleware attaches
 *   `Sentry.setUser({ id, email, role })` to every request and the v10
 *   httpIntegration captures the request body / query string into the
 *   event. Without a scrubber every exception ships the user's email
 *   plus the request payload to Sentry/GlitchTip — under GDPR / PIPEDA
 *   that's data the user never consented to sending.
 *
 * The fix: extract the redaction logic into `redactSentryEvent` and
 * wire it as `Sentry.init({ beforeSend })`. The unit test below pins
 * every branch of the redaction.
 */

import { describe, expect, it } from 'vitest';
import { redactSentryEvent } from './sentry.js';

describe('redactSentryEvent', () => {
  it('replaces user.email and user.username with [REDACTED]', () => {
    const event = {
      user: { id: 'user-1', email: 'alice@example.com', username: 'alice' },
    };
    const out = redactSentryEvent(event);
    expect(out.user?.email).toBe('[REDACTED]');
    expect(out.user?.username).toBe('[REDACTED]');
    // id is intentionally kept (low-cardinality, useful for grouping).
    expect(out.user?.id).toBe('user-1');
  });

  it('masks the last two IPv4 octets', () => {
    const event = { user: { id: 'u', ip_address: '203.0.113.42' } };
    const out = redactSentryEvent(event);
    // Keeps the /16 (network portion) and redacts the /16 host portion.
    expect(out.user?.ip_address).toBe('203.0.[REDACTED]');
  });

  it('masks the last three IPv6 groups', () => {
    const event = { user: { id: 'u', ip_address: '2001:db8:abcd:0012:3456:7890:1234:5678' } };
    const out = redactSentryEvent(event);
    expect(out.user?.ip_address).toBe('2001:db8:abcd::[REDACTED]');
  });

  it('scrubs cookie, set-cookie, authorization, x-csrf-token, x-api-key headers', () => {
    const event = {
      request: {
        headers: {
          cookie: 'bowin_session=abc; bowin_csrf=def',
          'set-cookie': 'bowin_session=xyz; HttpOnly',
          authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.sig',
          'x-csrf-token': 'csrf-secret-value',
          'x-api-key': 'api-key-secret',
          'user-agent': 'Mozilla/5.0',
          accept: 'application/json',
        },
      },
    };
    const out = redactSentryEvent(event);
    const headers = out.request?.headers as Record<string, string>;
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers['set-cookie']).toBe('[REDACTED]');
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers['x-csrf-token']).toBe('[REDACTED]');
    expect(headers['x-api-key']).toBe('[REDACTED]');
    // Non-sensitive headers survive untouched.
    expect(headers['user-agent']).toBe('Mozilla/5.0');
    expect(headers.accept).toBe('application/json');
  });

  it('redacts request.data (body) and request.query_string unconditionally', () => {
    const event = {
      request: {
        data: { email: 'alice@example.com', token: 'magic-link-token' },
        query_string: 'token=eyJhbGciOiJIUzI1NiJ9…&code=123456',
      },
    };
    const out = redactSentryEvent(event);
    expect(out.request?.data).toBe('[REDACTED]');
    expect(out.request?.query_string).toBe('[REDACTED]');
  });

  it('redacts email fields nested under arbitrary context keys', () => {
    const event = {
      contexts: {
        user: { email: 'alice@example.com', name: 'Alice' },
        payment: { email: 'billing@example.com', last4: '4242' },
        request_state: { foo: 'bar' },
      },
    };
    const out = redactSentryEvent(event);
    const contexts = out.contexts as Record<string, Record<string, unknown>>;
    expect(contexts.user.email).toBe('[REDACTED]');
    expect(contexts.user.name).toBe('Alice');
    expect(contexts.payment.email).toBe('[REDACTED]');
    expect(contexts.payment.last4).toBe('4242');
    // Context without an `email` field is left alone.
    expect(contexts.request_state).toEqual({ foo: 'bar' });
  });

  it('is a no-op when the event has no user / request / contexts', () => {
    const event = {};
    expect(redactSentryEvent(event)).toEqual({});
  });

  it('covers a full event with user, request, and contexts in one call', () => {
    const event = {
      user: { id: 'u1', email: 'alice@example.com', ip_address: '198.51.100.7' },
      request: {
        headers: { cookie: 'sid=abc', 'x-csrf-token': 'csrf' },
        data: { profile: 'alice', token: 't' },
        query_string: 'token=t',
      },
      contexts: { user: { email: 'alice@example.com' } },
    };
    const out = redactSentryEvent(event);
    // /16 mask — the regex keeps the first two IPv4 octets and redacts the host portion.
    expect(out).toMatchObject({
      user: { id: 'u1', email: '[REDACTED]', ip_address: '198.51.[REDACTED]' },
      request: {
        headers: { cookie: '[REDACTED]', 'x-csrf-token': '[REDACTED]' },
        data: '[REDACTED]',
        query_string: '[REDACTED]',
      },
      contexts: { user: { email: '[REDACTED]' } },
    });
  });
});

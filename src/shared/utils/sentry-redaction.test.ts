import { describe, expect, it } from 'vitest';
import { REDACTED, redactBreadcrumb, redactSentryEvent, scrubString, scrubValue, type RedactableEvent } from './sentry-redaction';

// Built at runtime so secret scanners don't flag a JWT literal in source.
const b64url = (value: string) => Buffer.from(value).toString('base64url');
const JWT = [b64url('{"alg":"HS256"}'), b64url('{"userId":"u1"}'), b64url('signature-value')].join('.');
const MAGIC = 'a'.repeat(64);

describe('scrubString', () => {
  it('masks emails, phone numbers, JWTs and bearer tokens', () => {
    const out = scrubString(`guardian jane.doe+kid@example.com called +1 (555) 123-4567 / 555.987.6543 / +15551234567 with Bearer ${JWT} and ${JWT}`);
    expect(out).not.toMatch(/jane\.doe/);
    expect(out).not.toMatch(/555/);
    expect(out).not.toContain(JWT);
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('masks credential query params, session cookies and long hex tokens', () => {
    expect(scrubString(`/verify?token=${MAGIC}&x=1`)).toBe(`/verify?token=${REDACTED}&x=1`);
    expect(scrubString('/api/public/check-registration?email=a@b.co&code=123456')).not.toMatch(/a@b|123456/);
    expect(scrubString('Cookie: bowin_session=abc.def; bowin_csrf=xyz')).toBe(`Cookie: bowin_session=${REDACTED}; bowin_csrf=${REDACTED}`);
    expect(scrubString(`invite ${MAGIC} expired`)).toBe('invite [TOKEN] expired');
  });

  it('leaves ids, UUIDs, dates and timestamps intact so events stay debuggable', () => {
    const text = 'match 3f2b6c1e-1234-4567-8901-123456789012 at 2026-09-26T10:00:00Z ts=1758850000000 ring 12 score 5-3';
    expect(scrubString(text)).toBe(text);
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys at any depth and scrubs nested strings', () => {
    const out = scrubValue({
      registration: {
        parentEmail: 'p@example.com',
        parent_phone: '555-123-4567',
        guardianName: 'Jane Doe',
        dateOfBirth: '2015-01-01',
        medicalNotes: 'asthma',
        emergencyContact: { name: 'x' },
        tournamentId: 't-1',
        note: 'reach me at p@example.com',
      },
      password: 'hunter2',
      accessToken: 'abc',
      list: [{ email: 'x@y.co' }],
    });
    expect(out).toEqual({
      registration: {
        parentEmail: REDACTED,
        parent_phone: REDACTED,
        guardianName: REDACTED,
        dateOfBirth: REDACTED,
        medicalNotes: REDACTED,
        emergencyContact: REDACTED,
        tournamentId: 't-1',
        note: 'reach me at [EMAIL]',
      },
      password: REDACTED,
      accessToken: REDACTED,
      list: [{ email: REDACTED }],
    });
  });

  it('does not mutate its input and bounds recursion depth', () => {
    const input = { email: 'a@b.co' };
    scrubValue(input);
    expect(input.email).toBe('a@b.co');
    type Nested = { next?: Nested };
    const deep: Nested = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) { cursor.next = {}; cursor = cursor.next; }
    expect(JSON.stringify(scrubValue(deep))).toContain('[Truncated]');
  });
});

describe('redactSentryEvent', () => {
  it('scrubs a full server-side event', () => {
    const event: RedactableEvent = {
      message: 'Registration failed for guardian@example.com',
      user: { id: 'user-1', email: 'director@example.com', username: 'director', ip_address: '203.0.113.9' },
      request: {
        url: `https://app.example.com/verify?token=${MAGIC}`,
        headers: {
          Authorization: `Bearer ${JWT}`,
          Cookie: 'bowin_session=abc',
          'X-CSRF-Token': 'csrf',
          'x-api-key': 'k',
          'User-Agent': 'Mozilla/5.0',
        },
        cookies: { bowin_session: 'abc' },
        data: { competitor: { firstName: 'Kid', dateOfBirth: '2015-01-01' }, parentEmail: 'p@example.com', parentPhone: '5551234567' },
        query_string: 'email=p@example.com&tournamentId=t-1',
        env: { REMOTE_ADDR: '203.0.113.9' },
      },
      exception: { values: [{ value: `Unique constraint failed for p@example.com (${JWT})` }] },
      breadcrumbs: [{ message: 'POST /api/public/register p@example.com', data: { body: '{"parentPhone":"555-123-4567"}' } }],
      extra: { parentEmail: 'p@example.com', divisionId: 'd-1' },
      contexts: { custom: { email: 'x@y.co', path: '/api/x' }, trace: { trace_id: 'abc', parent_span_id: 'def' }, os: { name: 'Linux' } },
      tags: { route: '/api/public/register' },
    };

    const out = redactSentryEvent(event);
    const serialized = JSON.stringify(out);

    expect(out).toBe(event);
    expect(out.user).toEqual({ id: 'user-1' });
    expect(out.request?.headers).toEqual({ 'User-Agent': 'Mozilla/5.0' });
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.env).toBeUndefined();
    expect(out.request?.query_string).toBe(`email=${REDACTED}&tournamentId=t-1`);
    expect(out.request?.url).toBe(`https://app.example.com/verify?token=${REDACTED}`);
    expect(out.extra).toEqual({ parentEmail: REDACTED, divisionId: 'd-1' });
    expect(out.contexts).toEqual({
      custom: { email: REDACTED, path: '/api/x' },
      trace: { trace_id: 'abc', parent_span_id: 'def' },
      os: { name: 'Linux' },
    });
    expect(out.breadcrumbs?.[0].data).toEqual({ body: REDACTED });
    for (const leaked of ['@example.com', '555', JWT, MAGIC, 'bowin_session=abc', '2015-01-01', '203.0.113.9', 'csrf']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('redacts non-string query_string shapes wholesale', () => {
    const out = redactSentryEvent({ request: { query_string: [['token', 'abc']] } });
    expect(out.request?.query_string).toBe(REDACTED);
  });

  it('is a no-op on an empty event', () => {
    expect(redactSentryEvent({})).toEqual({});
  });
});

describe('redactBreadcrumb', () => {
  it('drops credential headers and bodies from fetch/http breadcrumbs', () => {
    const crumb = redactBreadcrumb({
      message: `GET /accept-invite?token=${MAGIC}`,
      data: {
        url: `/api/invites/verify/${MAGIC}`,
        method: 'POST',
        status_code: 200,
        headers: { authorization: `Bearer ${JWT}`, cookie: 'bowin_session=1', accept: 'application/json' },
        request_body: '{"email":"a@b.co"}',
      },
    });
    expect(crumb.message).toBe(`GET /accept-invite?token=${REDACTED}`);
    expect(crumb.data).toEqual({
      url: '/api/invites/verify/[TOKEN]',
      method: 'POST',
      status_code: 200,
      headers: { accept: 'application/json' },
      request_body: REDACTED,
    });
  });
});

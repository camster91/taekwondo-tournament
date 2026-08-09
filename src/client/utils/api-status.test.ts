import { describe, expect, it } from 'vitest';
import { ApiFailure, fetchJson, getApiFailure } from './api-status.js';

describe('typed API status', () => {
  it.each([
    [404, 'not_found', false],
    [429, 'rate_limited', true],
    [401, 'unauthenticated', false],
    [403, 'forbidden', false],
    [409, 'conflict', false],
    [422, 'validation', false],
    [500, 'unavailable', true],
  ] as const)('classifies HTTP %s as %s', async (status, kind, retryable) => {
    const request = async () => new Response(JSON.stringify({ error: 'server message' }), {
      status,
      headers: status === 429 ? { 'Retry-After': '42' } : undefined,
    });
    const error = await fetchJson(request, '/api/test').catch((value) => value);
    expect(error).toBeInstanceOf(ApiFailure);
    expect(getApiFailure(error)).toMatchObject({ kind, status, retryable, message: 'server message' });
    if (status === 429) expect(getApiFailure(error)?.retryAfterSeconds).toBe(42);
  });

  it('classifies network failures without inventing a response status', async () => {
    const error = await fetchJson(async () => { throw new TypeError('offline'); }, '/api/test').catch((value) => value);
    expect(getApiFailure(error)).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(getApiFailure(error)?.status).toBeUndefined();
  });

  it('returns parsed success data', async () => {
    await expect(fetchJson(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }), '/api/test'))
      .resolves.toEqual({ ok: true });
  });

  it('treats malformed successful JSON as a retryable transport failure', async () => {
    const error = await fetchJson(async () => new Response('<html>proxy error</html>', { status: 200 }), '/api/test').catch((value) => value);
    expect(getApiFailure(error)).toMatchObject({ kind: 'unavailable', retryable: true, status: 200 });
  });
});

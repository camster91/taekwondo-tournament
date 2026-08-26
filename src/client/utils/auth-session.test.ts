import { describe, expect, it, vi } from 'vitest';
import { hydrateVerifiedSession } from './auth-session.js';

const validUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'director@example.com',
  firstName: 'Demo',
  lastName: 'Director',
  role: 'director',
};

describe('verified session hydration', () => {
  it('returns a validated user only after /me succeeds', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(validUser), { status: 200 }));
    await expect(hydrateVerifiedSession(request)).resolves.toEqual(validUser);
  });

  it.each([
    ['unauthenticated', async () => new Response(JSON.stringify({ error: 'no session' }), { status: 401 })],
    ['server failure', async () => new Response(JSON.stringify({ error: 'down' }), { status: 500 })],
    ['network failure', async () => { throw new TypeError('offline'); }],
    ['malformed JSON', async () => new Response('<html>bad gateway</html>', { status: 200 })],
    ['invalid user payload', async () => new Response(JSON.stringify({ id: 'only-an-id' }), { status: 200 })],
  ])('fails when hydration has a %s', async (_label, request) => {
    await expect(hydrateVerifiedSession(request)).rejects.toThrow(
      'Sign-in was verified, but the session could not be loaded. Try again.',
    );
  });

  it.each([
    ['missing id', { ...validUser, id: undefined }],
    ['invalid email', { ...validUser, email: 42 }],
    ['invalid first name', { ...validUser, firstName: null }],
    ['invalid last name', { ...validUser, lastName: false }],
    ['invalid role', { ...validUser, role: 'owner' }],
    ['invalid creation date', { ...validUser, createdAt: 123 }],
    ['invalid demo marker', { ...validUser, isDemo: 'yes' }],
    ['invalid demo expiry', { ...validUser, demoExpiresAt: 'not-a-date' }],
  ])('rejects a user payload with %s', async (_label, payload) => {
    const request = async () => new Response(JSON.stringify(payload), { status: 200 });
    await expect(hydrateVerifiedSession(request)).rejects.toThrow('session could not be loaded');
  });
});

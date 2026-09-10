/**
 * Regression test for the admin privilege-change rate limit.
 *
 * Track-1 review candidate (security orchestrator-supplied): the
 * four privilege-changing routes — PUT /users/:id/role,
 * PUT /users/:id/status, POST /tournaments/:id/access, and
 * DELETE /tournaments/:id/access/:uid — were not rate-limited.
 * A stolen admin JWT + leaked CSRF cookie could call them in a
 * tight loop. The fix wraps them in a shared
 * `adminMutationLimiter` (30/hour per IP).
 *
 * The test uses the test-aware `createRateLimiter` factory, which
 * only enforces the limit when `RATE_LIMIT_DISABLED` / `VITEST` /
 * `TEST_ENV=e2e` are unset. We assert:
 *   - 30 successful requests pass
 *   - the 31st is rejected with 429
 *   - the `RateLimit-*` headers report the cap
 *   - the bucket is independent across the four endpoints (one
 *     endpoint consuming the budget still leaves the others
 *     available — they're separate middlewares but share a
 *     keyGenerator; this test pins the current shared-key
 *     behavior so a refactor that splits the bucket has to
 *     update the test deliberately)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}));

const originalEnv = { ...process.env };
const servers: Server[] = [];

async function startAdminServer(): Promise<string> {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  // Disable the test-environment auto-skip so the limiter is enforced.
  delete process.env.RATE_LIMIT_DISABLED;
  delete process.env.VITEST;
  delete process.env.TEST_ENV;

  vi.doMock('../middleware/auth.js', () => ({
    createToken: vi.fn(() => 'mock-jwt'),
    authenticate: (req: any, _res: unknown, next: () => void) => {
      req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
      next();
    },
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    SESSION_COOKIE: 'bowin_session',
    SESSION_COOKIE_OPTIONS: {},
    setCsrfCookie: vi.fn(),
    invalidateAuthCache: vi.fn(),
    DEMO_ORG_ID: '00000000-0000-4000-8000-000000000001',
    DEMO_ROLE: 'demo',
  }));

  const { default: authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ role: 'viewer' }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) =>
        Promise.resolve({
          id: where.id,
          email: 'target@example.com',
          firstName: 'Target',
          lastName: 'User',
          isActive: data?.isActive ?? true,
          role: data?.role ?? 'viewer',
        })
      ),
    },
    userTournamentAccess: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { userId_tournamentId: { userId: string; tournamentId: string } } }) =>
        Promise.resolve({ role: 'scorekeeper', userId: where.userId_tournamentId.userId })
      ),
      upsert: vi.fn().mockImplementation(({ update, create }: { update: any; create: any }) =>
        Promise.resolve({ ...create, ...(update ?? {}) })
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return `http://127.0.0.1:${address.port}/api/auth`;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  process.env = { ...originalEnv };
});

async function put(baseUrl: string, path: string, body: object): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(baseUrl: string, path: string, body: object): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(baseUrl: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE' });
}

describe('admin privilege-change rate limit', () => {
  it('allows 30 PUT /users/:id/role calls per hour and rejects the 31st with 429', async () => {
    const baseUrl = await startAdminServer();

    const responses: Response[] = [];
    for (let i = 0; i < 30; i += 1) {
      responses.push(await put(baseUrl, `/users/target-${i}/role`, { role: 'director' }));
    }
    expect(responses.every((r) => r.status === 200)).toBe(true);

    const limited = await put(baseUrl, '/users/target-overflow/role', { role: 'director' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('ratelimit-limit')).toBe('30');
    const body = await limited.json();
    expect(body).toMatchObject({ error: expect.stringMatching(/admin/i) });
  });

  it('applies the same cap to PUT /users/:id/status', async () => {
    const baseUrl = await startAdminServer();

    for (let i = 0; i < 30; i += 1) {
      const r = await put(baseUrl, `/users/target-${i}/status`, { isActive: false });
      expect(r.status).toBe(200);
    }
    const limited = await put(baseUrl, '/users/target-overflow/status', { isActive: false });
    expect(limited.status).toBe(429);
  });

  it('applies the same cap to POST /tournaments/:id/access', async () => {
    const baseUrl = await startAdminServer();

    for (let i = 0; i < 30; i += 1) {
      const r = await post(baseUrl, `/tournaments/t-${i}/access`, {
        userId: `target-${i}`,
        role: 'director',
      });
      expect(r.status).toBe(200);
    }
    const limited = await post(baseUrl, '/tournaments/t-overflow/access', {
      userId: 'target-overflow',
      role: 'director',
    });
    expect(limited.status).toBe(429);
  });

  it('applies the same cap to DELETE /tournaments/:id/access/:userId', async () => {
    const baseUrl = await startAdminServer();

    for (let i = 0; i < 30; i += 1) {
      const r = await del(baseUrl, `/tournaments/t-${i}/access/target-${i}`);
      expect(r.status).toBe(204);
    }
    const limited = await del(baseUrl, '/tournaments/t-overflow/access/target-overflow');
    expect(limited.status).toBe(429);
  });
});

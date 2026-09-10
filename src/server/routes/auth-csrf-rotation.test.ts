/**
 * Regression test for CSRF rotation on privilege change.
 *
 * Track-1 security review 3.7 (MEDIUM, but a real defense-in-depth gap):
 *   The CSRF cookie is set at login and never rotated. A long-lived
 *   session whose CSRF cookie is exfiltrated (e.g. via a one-off XSS)
 *   keeps that CSRF working until the session cookie expires (7 days).
 *   Rotating the CSRF token on privilege change limits the window.
 *
 * The fix calls `setCsrfCookie(res)` after:
 *   - PUT  /api/auth/users/:userId/role        (role change)
 *   - PUT  /api/auth/users/:userId/status      (account disabled)
 *   - POST /api/auth/tournaments/:id/access    (per-tournament role grant)
 *   - DEL  /api/auth/tournaments/:id/access/:uid (per-tournament revoke)
 *
 * This test mounts the auth router with a real Express app, mocks the
 * Prisma + middleware, and asserts that `setCsrfCookie` is invoked on
 * every privilege-changing response. A separate negative test asserts
 * that no-privilege-change (e.g. granting the same per-tournament role
 * a second time) does NOT rotate the CSRF cookie, so we don't churn
 * valid sessions unnecessarily.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const setCsrfCookie = vi.hoisted(() => vi.fn());

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}));

interface MockPrisma {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  userTournamentAccess: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

async function startAuthServer(): Promise<{
  baseUrl: string;
  prisma: MockPrisma;
}> {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_DISABLED = '1';

  setCsrfCookie.mockClear();

  const prisma: MockPrisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockImplementation(({ data, where }: { data: any; where: { id: string } }) =>
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
      findUnique: vi.fn(),
      upsert: vi.fn().mockImplementation(({ update, create }: { update: any; create: any }) =>
        Promise.resolve({ ...create, ...(update ?? {}) })
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
  };

  // Wire the middleware mock with setCsrfCookie from the outer scope.
  vi.doMock('../middleware/auth.js', () => ({
    createToken: vi.fn(() => 'mock-jwt'),
    authenticate: (req: any, _res: unknown, next: () => void) => {
      req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
      next();
    },
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    SESSION_COOKIE: 'bowin_session',
    SESSION_COOKIE_OPTIONS: {},
    setCsrfCookie,
    invalidateAuthCache: vi.fn(),
    DEMO_ORG_ID: '00000000-0000-4000-8000-000000000001',
    DEMO_ROLE: 'demo',
  }));

  const { default: authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = prisma;
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { baseUrl: `http://127.0.0.1:${address.port}/api/auth`, prisma };
}

const originalEnv = { ...process.env };
const servers: Server[] = [];
let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
  process.env = { ...originalEnv };
});

async function withServer<T>(run: (baseUrl: string, prisma: MockPrisma) => Promise<T>): Promise<T> {
  const { baseUrl, prisma } = await startAuthServer();
  cleanup = () => new Promise<void>((resolve) => (baseUrl, prisma, setTimeout(resolve, 0))); // no-op
  return run(baseUrl, prisma);
}

describe('CSRF rotation on privilege change', () => {
  it('rotates the CSRF cookie on PUT /api/auth/users/:userId/role', async () => {
    await withServer(async (baseUrl, prisma) => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'viewer' });
      const before = setCsrfCookie.mock.calls.length;
      const res = await fetch(`${baseUrl}/users/target-user-1/role`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'director' }),
      });
      expect(res.status).toBe(200);
      expect(setCsrfCookie.mock.calls.length).toBe(before + 1);
    });
  });

  it('rotates the CSRF cookie on PUT /api/auth/users/:userId/status', async () => {
    await withServer(async (baseUrl) => {
      const before = setCsrfCookie.mock.calls.length;
      const res = await fetch(`${baseUrl}/users/target-user-2/status`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      expect(res.status).toBe(200);
      expect(setCsrfCookie.mock.calls.length).toBe(before + 1);
    });
  });

  it('rotates the CSRF cookie when per-tournament role CHANGES', async () => {
    await withServer(async (baseUrl, prisma) => {
      prisma.userTournamentAccess.findUnique.mockResolvedValueOnce({ role: 'scorekeeper' });
      const before = setCsrfCookie.mock.calls.length;
      const res = await fetch(`${baseUrl}/tournaments/t-1/access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'target-user-3', role: 'director' }),
      });
      expect(res.status).toBe(200);
      expect(setCsrfCookie.mock.calls.length).toBe(before + 1);
    });
  });

  it('rotates the CSRF cookie on DELETE /api/auth/tournaments/:id/access/:userId', async () => {
    await withServer(async (baseUrl, prisma) => {
      prisma.userTournamentAccess.findUnique.mockResolvedValueOnce({ userId: 'target-user-4' });
      const before = setCsrfCookie.mock.calls.length;
      const res = await fetch(`${baseUrl}/tournaments/t-2/access/target-user-4`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(setCsrfCookie.mock.calls.length).toBe(before + 1);
    });
  });

  it('does NOT rotate the CSRF cookie when per-tournament role is unchanged', async () => {
    // Re-grant the same role the user already has: no privilege change,
    // no CSRF rotation. Churning the cookie on no-op grants would log
    // out any browser session mid-shift.
    await withServer(async (baseUrl, prisma) => {
      prisma.userTournamentAccess.findUnique.mockResolvedValueOnce({ role: 'scorekeeper' });
      const before = setCsrfCookie.mock.calls.length;
      const res = await fetch(`${baseUrl}/tournaments/t-3/access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'target-user-5', role: 'scorekeeper' }),
      });
      expect(res.status).toBe(200);
      expect(setCsrfCookie.mock.calls.length).toBe(before);
    });
  });

  it('does NOT rotate the CSRF cookie on a failed role change (self-demotion)', async () => {
    // Self-demotion is rejected with 400 before reaching the DB; the
    // CSRF cookie should not be rotated on rejected requests.
    await withServer(async (baseUrl) => {
      const before = setCsrfCookie.mock.calls.length;
      const res = await fetch(`${baseUrl}/users/admin-1/role`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      });
      expect(res.status).toBe(400);
      expect(setCsrfCookie.mock.calls.length).toBe(before);
    });
  });
});

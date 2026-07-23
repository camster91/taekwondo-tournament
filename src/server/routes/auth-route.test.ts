/**
 * Regression tests for the auth route handlers that produce side
 * effects on tokenVersion / auth cache state.
 *
 * Pinning:
 *  - POST /tournaments/:tournamentId/access bumps tokenVersion
 *    (and invalidates the auth cache) only when the per-tournament
 *    role ACTUALLY CHANGES. Granting the same role on an existing
 *    row is a no-op for the version bump.
 *  - DELETE /tournaments/:tournamentId/access/:userId bumps
 *    tokenVersion only when the access row was actually deleted.
 *    A 404 on a missing row must not bump the version (would log
 *    the user out mid-shift for a no-op).
 *  - /request-magic-link auto-creates a viewer user only when
 *    ENABLE_DEV_AUTH AND NODE_ENV!=production both hold. The
 *    previous gate accepted NODE_ENV=staging with no mail key and
 *    leaked viewer accounts.
 *
 * Background: D16-1 and D16-2 in the auth.ts audit. Tests run with
 * mocked prisma / middleware so they don't need a database or a
 * running Express app. Stubs the heavy middleware/auth import with
 * `vi.mock` so JWT_SECRET/process.exit side effects don't fire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invalidateAuthCache = vi.fn();

// Storage for handlers captured by the vi.mock('express', ...)
// factory. We can't use a top-level `const` here — vi.mock
// factories are hoisted ABOVE the rest of the module body, so
// any closure over a const would hit the TDZ when the factory
// first fires. Inline the key string so no symbol resolution is
// needed during factory evaluation.
type CapturedHandler = {
  method: string;
  path: string;
  middleware: any[];
  handler: any;
};
function getCaptured(): CapturedHandler[] {
  const g = globalThis as any;
  if (!g['__capturedExpressHandlers__']) g['__capturedExpressHandlers__'] = [];
  return g['__capturedExpressHandlers__'];
}

// --- Module mocks. These run BEFORE the route file imports so the
// route file picks up the stubs instead of the real
// middleware/auth.js (which calls process.exit when JWT_SECRET
// missing) and the real services/email.js (which fetches Mailgun).
vi.mock('../middleware/auth.js', () => ({
  createToken: vi.fn(() => 'mock-jwt-token'),
  authenticate: (req: any, _res: any, next: any) => {
    req.user = req._mockUser;
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: any, _res: any, next: any) => {
      if (!roles.includes(req.user?.role)) {
        return _res.status(403).json({ error: 'Forbidden' });
      }
      next();
    },
  SESSION_COOKIE: 'bowin_session',
  SESSION_COOKIE_OPTIONS: {},
  invalidateAuthCache: (...args: any[]) => invalidateAuthCache(...args),
}));

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => false),
}));
vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  welcomeEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}));

vi.mock('express', () => {
  const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
  const fakeRouter: any = {};
  const wrap = (method: string) =>
    (path: string, ...args: any[]) => {
      const handler = args[args.length - 1];
      const middleware = args.slice(0, -1);
      getCaptured().push({ method, path, middleware, handler });
      return fakeRouter;
    };
  for (const m of methods) fakeRouter[m] = wrap(m);
  fakeRouter.use = vi.fn(() => fakeRouter);
  const Router = vi.fn(() => fakeRouter);
  return { Router, default: { Router } };
});

import '../routes/auth.js';

const findHandler = (method: string, pathReg: RegExp) => {
  const match = getCaptured().find(
    (h: CapturedHandler) => h.method === method && pathReg.test(h.path),
  );
  if (!match) throw new Error(`No handler for ${method} ${pathReg}`);
  return match;
};

const mockReq = (overrides: any = {}): any => ({
  body: {},
  params: {},
  headers: {},
  app: { locals: { prisma: null } },
  ...overrides,
});

const mockRes = (): any => {
  const res: any = { statusCode: 200, body: undefined, headersSent: false };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res.body = body;
    res.headersSent = true;
    return res;
  });
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  res.send = vi.fn(() => {
    res.headersSent = true;
    return res;
  });
  return res;
};

// Minimal prisma mock — supply only the methods the handlers touch.
const buildPrismaMock = (overrides: any = {}) => {
  const user: any = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: 'target-user', role: 'viewer', tokenVersion: 0 }),
    count: vi.fn(),
  };
  const userTournamentAccess: any = {
    findUnique: vi.fn(),
    upsert: vi.fn().mockResolvedValue({
      role: 'viewer',
      user: { id: 'target-user' },
      tournament: { id: 't-1', name: 'Test' },
    }),
    delete: vi.fn().mockResolvedValue({ userId: 'target-user', tournamentId: 't-1' }),
  };
  const magicLink: any = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const invitation: any = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  return {
    user: { ...user, ...(overrides.user ?? {}) },
    userTournamentAccess: { ...userTournamentAccess, ...(overrides.userTournamentAccess ?? {}) },
    magicLink: { ...magicLink, ...(overrides.magicLink ?? {}) },
    invitation: { ...invitation, ...(overrides.invitation ?? {}) },
  };
};

// Cross-test clean state. Don't reset the captured-handler
// array — the route file's handlers register once per import
// (ESM-cached). Only reset the invalidateAuthCache spy.
beforeEach(() => {
  invalidateAuthCache.mockReset();
});

describe('POST /tournaments/:tournamentId/access — tokenVersion bump', () => {
  it('bumps tokenVersion + invalidates cache when role changes', async () => {
    const prisma = buildPrismaMock({
      userTournamentAccess: {
        findUnique: vi.fn().mockResolvedValue({ role: 'viewer' }),
        upsert: vi.fn().mockResolvedValue({
          role: 'director',
          user: { id: 'target-user' },
          tournament: { id: 't-1', name: 'Test' },
        }),
      },
      user: {
        update: vi.fn().mockResolvedValue({ id: 'target-user' }),
      },
    });

    const handler = findHandler('post', /\/tournaments\/:tournamentId\/access$/).handler;

    const req = mockReq({
      user: { id: 'admin-1', email: 'a@x.com', role: 'admin' },
      params: { tournamentId: 't-1' },
      body: { userId: 'target-user', role: 'director' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(prisma.user.update).toHaveBeenCalledOnce();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    });
    expect(invalidateAuthCache).toHaveBeenCalledWith('target-user');
  });

  it('does NOT bump tokenVersion when granting the same role (no-op upsert)', async () => {
    const prisma = buildPrismaMock({
      userTournamentAccess: {
        findUnique: vi.fn().mockResolvedValue({ role: 'viewer' }),
        upsert: vi.fn().mockResolvedValue({
          role: 'viewer',
          user: { id: 'target-user' },
          tournament: { id: 't-1', name: 'Test' },
        }),
      },
      user: {
        update: vi.fn().mockResolvedValue({ id: 'target-user' }),
      },
    });

    const handler = findHandler('post', /\/tournaments\/:tournamentId\/access$/).handler;

    const req = mockReq({
      user: { id: 'admin-1', email: 'a@x.com', role: 'admin' },
      params: { tournamentId: 't-1' },
      body: { userId: 'target-user', role: 'viewer' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(invalidateAuthCache).not.toHaveBeenCalled();
  });

  it('bumps tokenVersion when creating a NEW access row (existing is null)', async () => {
    const prisma = buildPrismaMock({
      userTournamentAccess: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          role: 'director',
          user: { id: 'target-user' },
          tournament: { id: 't-1', name: 'Test' },
        }),
      },
    });

    const handler = findHandler('post', /\/tournaments\/:tournamentId\/access$/).handler;
    const req = mockReq({
      user: { id: 'admin-1', email: 'a@x.com', role: 'admin' },
      params: { tournamentId: 't-1' },
      body: { userId: 'target-user', role: 'director' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(prisma.user.update).toHaveBeenCalledOnce();
    expect(invalidateAuthCache).toHaveBeenCalledWith('target-user');
  });
});

describe('DELETE /tournaments/:tournamentId/access/:userId — tokenVersion bump', () => {
  it('bumps tokenVersion + invalidates cache when access row exists', async () => {
    const prisma = buildPrismaMock({
      userTournamentAccess: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'target-user' }),
        delete: vi.fn().mockResolvedValue({ userId: 'target-user', tournamentId: 't-1' }),
      },
    });

    const handler = findHandler('delete', /\/tournaments\/:tournamentId\/access\/:userId$/).handler;
    const req = mockReq({
      user: { id: 'admin-1', email: 'a@x.com', role: 'admin' },
      params: { tournamentId: 't-1', userId: 'target-user' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(prisma.userTournamentAccess.delete).toHaveBeenCalledOnce();
    expect(prisma.user.update).toHaveBeenCalledOnce();
    expect(invalidateAuthCache).toHaveBeenCalledWith('target-user');
    expect(res.statusCode).toBe(204);
  });

  it('returns 404 and does NOT bump tokenVersion on missing access row', async () => {
    const prisma = buildPrismaMock({
      userTournamentAccess: {
        findUnique: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue({}),
      },
    });

    const handler = findHandler('delete', /\/tournaments\/:tournamentId\/access\/:userId$/).handler;
    const req = mockReq({
      user: { id: 'admin-1', email: 'a@x.com', role: 'admin' },
      params: { tournamentId: 't-1', userId: 'target-user' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(prisma.userTournamentAccess.delete).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(invalidateAuthCache).not.toHaveBeenCalled();
  });
});

describe('POST /request-magic-link — dev-mode auto-create gate (D16-2)', () => {
  const origDev = process.env.ENABLE_DEV_AUTH;
  const origNodeEnv = process.env.NODE_ENV;
  const origMailgun = process.env.MAILGUN_API_KEY;

  beforeEach(() => {
    delete process.env.ENABLE_DEV_AUTH;
    delete process.env.NODE_ENV;
    delete process.env.MAILGUN_API_KEY;
  });

  // node-side cleanup
  if (typeof afterAll === 'function') {
    // restore env after suite — vitest has afterAll global via import
  }

  const buildHandlerReq = (prismaMock: any) => {
    const handler = findHandler('post', /\/request-magic-link$/).handler;
    return {
      handler,
      req: mockReq({
        body: { email: 'newuser@example.com' },
        app: { locals: { prisma: prismaMock } },
      }),
      res: mockRes(),
    };
  };

  it('auto-creates viewer when ENABLE_DEV_AUTH=1 AND NODE_ENV=development', async () => {
    process.env.ENABLE_DEV_AUTH = '1';
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_E2E_AUTH_BYPASS = ''; // keep e2e bypass off

    const prisma = buildPrismaMock({
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'auto-1',
          email: 'newuser@example.com',
          firstName: 'newuser',
          role: 'viewer',
          tokenVersion: 0,
        }),
      },
    });

    const { handler, req, res } = buildHandlerReq(prisma);
    await handler(req, res);

    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('viewer');
  });

  it('does NOT auto-create when NODE_ENV=staging (no ENABLE_DEV_AUTH)', async () => {
    // Regression for D16-2: the old gate was
    // `ENABLE_DEV_AUTH || NODE_ENV !== 'production'`, which let
    // a staging deploy with no mail key auto-create viewer
    // accounts. Both flags must be present now.
    process.env.NODE_ENV = 'staging';
    process.env.ENABLE_E2E_AUTH_BYPASS = '';

    const prisma = buildPrismaMock({
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    });

    const { handler, req, res } = buildHandlerReq(prisma);
    await handler(req, res);

    expect(prisma.user.create).not.toHaveBeenCalled();
    // Returns enumeration-safe 200 with the standard message
    expect(res.statusCode).toBe(200);
  });

  it('does NOT auto-create when NODE_ENV=production (any flag)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEV_AUTH = '1';
    process.env.ENABLE_E2E_AUTH_BYPASS = '';

    // Even with a mailgun key set, we delete it for the test so
    // inDevMode=true and only the devAuthEnabled gate is decisive.
    // In practice production+mailgun never auto-creates either.
    const prisma = buildPrismaMock({
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    });

    const { handler, req, res } = buildHandlerReq(prisma);
    await handler(req, res);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does NOT auto-create when ENABLE_DEV_AUTH is unset and NODE_ENV=development', async () => {
    // Both required. Only NODE_ENV != 'production' is not enough.
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_E2E_AUTH_BYPASS = '';

    const prisma = buildPrismaMock({
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    });

    const { handler, req, res } = buildHandlerReq(prisma);
    await handler(req, res);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

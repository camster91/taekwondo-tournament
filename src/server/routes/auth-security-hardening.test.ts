/**
 * Regression tests for auth-route hardening:
 *  - OTP brute force: every code attempt atomically reserves budget
 *    (conditional DB increment) BEFORE comparing, so parallel guesses
 *    can't exceed MAX_CODE_ATTEMPTS; re-requesting a code inherits the
 *    spent budget and is capped per email.
 *  - PUT /users/:userId/status drops the auth cache entry.
 *  - DELETE /gdpr/delete-account applies the same safeguards as
 *    DELETE /account; demo admins don't count as "another admin".
 *
 * Handlers are captured through a mocked express Router and driven
 * with a small in-memory Prisma double.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashSecret } from '../utils/token-hash.js';

const invalidateAuthCache = vi.fn();

type CapturedHandler = { method: string; path: string; handler: any };
function getCaptured(): CapturedHandler[] {
  const g = globalThis as any;
  if (!g['__capturedAuthHardeningHandlers__']) g['__capturedAuthHardeningHandlers__'] = [];
  return g['__capturedAuthHardeningHandlers__'];
}

vi.mock('../middleware/auth.js', () => ({
  createToken: vi.fn(() => 'mock-jwt-token'),
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  SESSION_COOKIE: 'bowin_session',
  SESSION_COOKIE_OPTIONS: {},
  setCsrfCookie: vi.fn(),
  invalidateAuthCache: (...args: any[]) => invalidateAuthCache(...args),
}));
vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => true),
}));
vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  welcomeEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('../services/audit-log.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'test'),
}));
vi.mock('express', () => {
  const fakeRouter: any = {};
  for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
    fakeRouter[m] = (path: string, ...args: any[]) => {
      getCaptured().push({ method: m, path, handler: args[args.length - 1] });
      return fakeRouter;
    };
  }
  fakeRouter.use = vi.fn(() => fakeRouter);
  const Router = vi.fn(() => fakeRouter);
  return { Router, default: { Router } };
});

import '../routes/auth.js';

const handlerFor = (method: string, path: string) => {
  const match = getCaptured().find((h) => h.method === method && h.path === path);
  if (!match) throw new Error(`No handler for ${method} ${path}`);
  return match.handler;
};

const mockRes = (): any => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((body: any) => { res.body = body; return res; });
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
};

// ---------------------------------------------------------------
// In-memory MagicLink table with DB-like atomic conditional updates.
// ---------------------------------------------------------------
type Link = {
  id: string; email: string; token: string; code: string;
  expiresAt: Date; createdAt: Date; usedAt: Date | null; failedAttempts: number;
};

function matches(row: Link, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    const value = (row as any)[key];
    if (cond === null) { if (value !== null) return false; continue; }
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as any;
      if ('in' in c && !c.in.includes(value)) return false;
      if ('lt' in c && !(value < c.lt)) return false;
      if ('gte' in c && !(value >= c.gte)) return false;
      if ('gt' in c && !(value > c.gt)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function magicLinkTable(initial: Partial<Link>[] = []) {
  let seq = 0;
  const rows: Link[] = initial.map((r) => ({
    id: `ml-${seq++}`, email: 'user@example.com', token: 'tok', code: hashSecret('123456'),
    expiresAt: new Date(Date.now() + 600_000), createdAt: new Date(), usedAt: null, failedAttempts: 0,
    ...r,
  }));
  // Yield between operations so parallel requests interleave like
  // real DB round-trips.
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const apply = (row: Link, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as any;
        if ('increment' in op) (row as any)[k] += op.increment;
        if ('decrement' in op) (row as any)[k] -= op.decrement;
      } else {
        (row as any)[k] = v;
      }
    }
  };
  return {
    rows,
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      await tick();
      const found = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === 'desc') found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return found[0] ? { ...found[0] } : null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      await tick();
      return rows.filter((r) => matches(r, where)).map((r) => ({ ...r }));
    }),
    // Atomic: evaluate + apply without yielding in between (like a
    // single UPDATE ... WHERE statement).
    updateMany: vi.fn(async ({ where, data }: any) => {
      await tick();
      let count = 0;
      for (const row of rows) {
        if (matches(row, where)) { apply(row, data); count++; }
      }
      return { count };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      await tick();
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) { rows.splice(i, 1); count++; }
      }
      return { count };
    }),
    create: vi.fn(async ({ data }: any) => {
      await tick();
      const row: Link = {
        id: `ml-${seq++}`, createdAt: new Date(), usedAt: null, failedAttempts: 0, ...data,
      };
      rows.push(row);
      return { ...row };
    }),
    update: vi.fn(async () => {
      throw new Error('non-atomic update() must not be used for attempt accounting');
    }),
  };
}

const activeUser = {
  id: 'user-1', email: 'user@example.com', firstName: 'U', lastName: 'Ser',
  role: 'director', isActive: true, tokenVersion: 0,
};

const verifyReq = (prisma: any, body: any) => ({ body, app: { locals: { prisma } }, headers: {} });

beforeEach(() => {
  invalidateAuthCache.mockReset();
});

describe('POST /verify-magic-link — atomic attempt budget', () => {
  const buildPrisma = (links: Partial<Link>[]) => {
    const magicLink = magicLinkTable(links);
    return {
      magicLink,
      user: {
        findUnique: vi.fn().mockResolvedValue(activeUser),
        update: vi.fn().mockResolvedValue(activeUser),
      },
    };
  };

  it('50 parallel wrong guesses consume at most MAX_CODE_ATTEMPTS (10) and burn the code', async () => {
    const prisma = buildPrisma([{ code: hashSecret('123456') }]);
    const handler = handlerFor('post', '/verify-magic-link');

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const res = mockRes();
        const guess = String(200000 + i);
        return handler(verifyReq(prisma, { email: 'user@example.com', code: guess }), res).then(() => res);
      }),
    );

    expect(results.every((r) => r.statusCode === 400)).toBe(true);
    const row = prisma.magicLink.rows[0];
    expect(row.failedAttempts).toBe(10);
    expect(row.usedAt).not.toBeNull();
  });

  it('a correct code racing 30 wrong guesses cannot win once 10 attempts are spent', async () => {
    const prisma = buildPrisma([{ code: hashSecret('123456') }]);
    const handler = handlerFor('post', '/verify-magic-link');

    const wrong = Array.from({ length: 30 }, (_, i) => {
      const res = mockRes();
      return handler(verifyReq(prisma, { email: 'user@example.com', code: String(300000 + i) }), res).then(() => res);
    });
    const correctRes = mockRes();
    const correct = handler(verifyReq(prisma, { email: 'user@example.com', code: '123456' }), correctRes).then(() => correctRes);
    const all = await Promise.all([...wrong, correct]);

    // Total comparisons are capped: successes + failures that got a
    // budget slot never exceed 10.
    const reservedCalls = prisma.magicLink.updateMany.mock.results.length;
    expect(reservedCalls).toBeGreaterThan(0);
    expect(prisma.magicLink.rows[0].failedAttempts).toBeLessThanOrEqual(10);
    const successes = all.filter((r) => r.statusCode === 200).length;
    expect(successes).toBeLessThanOrEqual(1);
  });

  it('rejects a CORRECT code when the budget is already exhausted', async () => {
    const prisma = buildPrisma([{ code: hashSecret('123456'), failedAttempts: 10 }]);
    const handler = handlerFor('post', '/verify-magic-link');
    const res = mockRes();

    await handler(verifyReq(prisma, { email: 'user@example.com', code: '123456' }), res);

    expect(res.statusCode).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.magicLink.rows[0].usedAt).not.toBeNull();
  });

  it('accepts a correct code within budget and marks the link used exactly once', async () => {
    const prisma = buildPrisma([{ code: hashSecret('123456'), failedAttempts: 3 }]);
    const handler = handlerFor('post', '/verify-magic-link');

    const [a, b] = await Promise.all([mockRes(), mockRes()].map((res) =>
      handler(verifyReq(prisma, { email: 'user@example.com', code: '123456' }), res).then(() => res),
    ));

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    expect(prisma.magicLink.rows[0].usedAt).not.toBeNull();
  });

  it('never uses the non-atomic update() for attempt accounting', async () => {
    const prisma = buildPrisma([{ code: hashSecret('123456') }]);
    const handler = handlerFor('post', '/verify-magic-link');
    await handler(verifyReq(prisma, { email: 'user@example.com', code: '000000' }), mockRes());
    expect(prisma.magicLink.update).not.toHaveBeenCalled();
    expect(prisma.magicLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ failedAttempts: { lt: 10 } }),
      data: { failedAttempts: { increment: 1 } },
    }));
  });
});

describe('POST /request-magic-link — budget does not reset', () => {
  const buildPrisma = (links: Partial<Link>[]) => ({
    magicLink: magicLinkTable(links),
    user: { findUnique: vi.fn().mockResolvedValue(activeUser), create: vi.fn() },
  });
  const requestReq = (prisma: any) => ({ body: { email: 'user@example.com' }, app: { locals: { prisma } }, headers: {} });

  it('new code inherits the spent attempts of recent codes and invalidates the old one', async () => {
    const prisma = buildPrisma([{ failedAttempts: 7 }]);
    const res = mockRes();

    await handlerFor('post', '/request-magic-link')(requestReq(prisma), res);

    expect(res.statusCode).toBe(200);
    expect(prisma.magicLink.create).toHaveBeenCalledOnce();
    expect(prisma.magicLink.create.mock.calls[0][0].data.failedAttempts).toBe(7);
    // Old link kept (for accounting) but no longer usable.
    expect(prisma.magicLink.rows).toHaveLength(2);
    expect(prisma.magicLink.rows[0].usedAt).not.toBeNull();
  });

  it('caps code issuance per email within the window (generic response, no new code)', async () => {
    const prisma = buildPrisma(Array.from({ length: 5 }, () => ({ usedAt: new Date() })));
    const res = mockRes();

    await handlerFor('post', '/request-magic-link')(requestReq(prisma), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/);
    expect(prisma.magicLink.create).not.toHaveBeenCalled();
  });

  it('links older than the window are purged and do not count', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const prisma = buildPrisma(Array.from({ length: 5 }, () => ({ createdAt: old, failedAttempts: 10 })));

    await handlerFor('post', '/request-magic-link')(requestReq(prisma), mockRes());

    expect(prisma.magicLink.create).toHaveBeenCalledOnce();
    expect(prisma.magicLink.create.mock.calls[0][0].data.failedAttempts).toBe(0);
  });
});

describe('PUT /users/:userId/status — auth cache invalidation', () => {
  it('invalidates the target user auth cache after the tokenVersion bump', async () => {
    const prisma = {
      user: { update: vi.fn().mockResolvedValue({ id: 'target', isActive: false }) },
    };
    const res = mockRes();
    await handlerFor('put', '/users/:userId/status')(
      { params: { userId: 'target' }, body: { isActive: false }, user: { id: 'admin-1', role: 'admin' }, app: { locals: { prisma } }, headers: {} },
      res,
    );

    expect(prisma.user.update.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
    expect(invalidateAuthCache).toHaveBeenCalledWith('target');
  });
});

describe('DELETE /gdpr/delete-account — same safeguards as DELETE /account', () => {
  const recent = () => new Date(Date.now() - 60 * 1000);
  const buildPrisma = (user: any, otherAdmins = 1) => {
    const tx = {
      organizationMember: { deleteMany: vi.fn() },
      userTournamentAccess: { deleteMany: vi.fn() },
      userAuditLog: { deleteMany: vi.fn() },
      userOnboardingChecklist: { deleteMany: vi.fn() },
      magicLink: { deleteMany: vi.fn() },
      user: { delete: vi.fn() },
    };
    return {
      tx,
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        count: vi.fn().mockResolvedValue(otherAdmins),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
  };
  const del = async (prisma: any) => {
    const res = mockRes();
    await handlerFor('delete', '/gdpr/delete-account')(
      { body: { confirmation: 'DELETE MY ACCOUNT' }, user: { id: 'u-1' }, app: { locals: { prisma } }, headers: {} },
      res,
    );
    return res;
  };

  it('refuses while the user still belongs to an organization', async () => {
    const prisma = buildPrisma({ id: 'u-1', email: 'u@x.com', role: 'director', lastLogin: recent(), organizationMembers: [{ id: 'm-1' }] });
    const res = await del(prisma);
    expect(res.statusCode).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a recent sign-in', async () => {
    const prisma = buildPrisma({ id: 'u-1', email: 'u@x.com', role: 'director', lastLogin: new Date(Date.now() - 60 * 60 * 1000), organizationMembers: [] });
    const res = await del(prisma);
    expect(res.statusCode).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('last non-demo admin cannot delete themselves (demo admins excluded from the count)', async () => {
    const prisma = buildPrisma({ id: 'u-1', email: 'u@x.com', role: 'admin', lastLogin: recent(), organizationMembers: [] }, 0);
    const res = await del(prisma);
    expect(res.statusCode).toBe(409);
    expect(prisma.user.count.mock.calls[0][0].where).toMatchObject({ role: 'admin', isActive: true, demoExpiresAt: null });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes, clears magic links + session, and invalidates the auth cache', async () => {
    const prisma = buildPrisma({ id: 'u-1', email: 'u@x.com', role: 'director', lastLogin: recent(), organizationMembers: [] });
    const res = await del(prisma);
    expect(res.statusCode).toBe(200);
    expect(prisma.tx.user.delete).toHaveBeenCalledWith({ where: { id: 'u-1' } });
    expect(prisma.tx.magicLink.deleteMany).toHaveBeenCalledWith({ where: { email: 'u@x.com' } });
    expect(invalidateAuthCache).toHaveBeenCalledWith('u-1');
    expect(res.clearCookie).toHaveBeenCalledWith('bowin_session', { path: '/' });
  });
});

describe('DELETE /account — demo admins excluded from last-admin count', () => {
  it('counts only non-demo active admins', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u-1', email: 'u@x.com', role: 'admin', lastLogin: new Date(), organizationMembers: [],
        }),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(),
    };
    const res = mockRes();
    await handlerFor('delete', '/account')(
      { body: { confirmation: 'u@x.com' }, user: { id: 'u-1' }, app: { locals: { prisma } }, headers: {} },
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(prisma.user.count.mock.calls[0][0].where).toMatchObject({ demoExpiresAt: null });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

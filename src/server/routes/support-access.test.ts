import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(),
  handlers: [] as Array<{ method: string; path: string; handler: any }>,
}));

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'patch'] as const) {
    router[method] = (path: string, ...args: any[]) => {
      mocks.handlers.push({ method, path, handler: args.at(-1) });
      return router;
    };
  }
  const Router = vi.fn(() => router);
  return { Router, default: { Router } };
});

vi.mock('express-rate-limit', () => ({ default: vi.fn(() => (_req: any, _res: any, next: any) => next()) }));
vi.mock('@prisma/client', () => ({ PrismaClient: class {} }));
vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  optionalAuthenticate: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  checkTournamentAccess: (...args: any[]) => mocks.checkTournamentAccess(...args),
}));
vi.mock('../middleware/validate.js', () => ({ validateRequest: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/email.js', () => ({ sendEmail: vi.fn() }));
vi.mock('./support-validation.js', () => ({
  supportChatSchema: {}, supportTicketQuerySchema: {}, supportTicketUpdateSchema: {},
  supportConfigSchema: {}, supportConfigTestSchema: {},
}));
vi.mock('../services/operational-query.js', () => ({
  answerOperationalQuery: vi.fn(),
  parseOperationalQuery: vi.fn(() => ({ kind: 'unsupported' })),
}));
vi.mock('../services/support-provider.js', () => ({
  assertSafeSupportProviderUrl: vi.fn(),
  readSupportConfigAuditTrail: vi.fn(() => []),
  testSupportProviderConnection: vi.fn(),
}));

import './support.js';

const handler = (method: string, path: string) => {
  const route = mocks.handlers.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Missing ${method.toUpperCase()} ${path} route`);
  return route.handler;
};

const response = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((statusCode: number) => { res.statusCode = statusCode; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
};

describe('support access boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not run platform diagnostics for anonymous support chat', async () => {
    const prisma: any = { supportTicket: { count: vi.fn() } };
    const req: any = {
      body: { message: 'Show the health snapshot', requestAssist: true },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.supportAssistant).toBeNull();
    expect(prisma.supportTicket.count).not.toHaveBeenCalled();
  });

  it('checks tournament access before authenticated support diagnostics', async () => {
    mocks.checkTournamentAccess.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    const prisma: any = { organizationMember: { findMany: vi.fn().mockResolvedValue([]) } };
    const req: any = {
      user: { id: 'user-a', email: 'a@example.test', role: 'viewer' },
      body: { message: 'Who is next?', tournamentId: 'foreign-tournament' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(403);
    expect(mocks.checkTournamentAccess).toHaveBeenCalledWith(req, prisma, 'foreign-tournament', 'viewer');
  });

  it('limits director ticket lists to their organization memberships', async () => {
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      supportTicket: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const req: any = { user: { id: 'director-a', role: 'director' }, query: {}, app: { locals: { prisma } } };
    const res = response();

    await handler('get', '/')(req, res);

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: { in: ['org-a'] } },
    }));
  });

  it('does not update a ticket outside the director organization', async () => {
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      supportTicket: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    const req: any = {
      user: { id: 'director-a', role: 'director' }, params: { id: 'foreign-ticket' }, body: {},
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('patch', '/:id')(req, res);

    expect(res.statusCode).toBe(404);
    expect(prisma.supportTicket.update).not.toHaveBeenCalled();
  });
});

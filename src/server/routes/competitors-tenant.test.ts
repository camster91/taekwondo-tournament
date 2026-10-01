import { describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => [] as Array<{
  method: string;
  path: string;
  handler: (...args: any[]) => any;
}>);

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (path: string, ...callbacks: any[]) => {
      handlers.push({ method, path, handler: callbacks.at(-1) });
      return router;
    };
  }
  return { Router: () => router };
});

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
  buildTournamentAccessFilter: vi.fn().mockResolvedValue({
    organizationId: { in: ['organization-1'] },
  }),
  resolveTournamentScope: vi.fn().mockResolvedValue({
    filter: { organizationId: { in: ['organization-1'] } },
    legacyPool: false,
    orgIds: ['organization-1'],
  }),
  buildCompetitorAccessFilter: vi.fn().mockResolvedValue({
    registrations: { some: { tournament: { organizationId: { in: ['organization-1'] } } } },
  }),
  buildCompetitorWriteFilter: vi.fn().mockResolvedValue({
    registrations: { every: { tournament: { organizationId: { in: ['organization-1'] } } } },
  }),
}));

vi.mock('../middleware/validate.js', () => ({ validateRequest: vi.fn(() => vi.fn()) }));
vi.mock('../index.js', () => ({ jsonBodyParser: vi.fn() }));
vi.mock('../services/excel-import.js', () => ({ importFromExcel: vi.fn() }));
vi.mock('../services/excel-template.js', () => ({
  generateImportTemplate: vi.fn(),
  getDefaultColumnMapping: vi.fn(),
}));
vi.mock('../services/excel-auto-map.js', () => ({ autoDetectMapping: vi.fn() }));

import './competitors.js';

describe('POST /:id/restore tenant isolation', () => {
  it('returns 404 without restoring a competitor outside the director organization', async () => {
    const route = handlers.find(
      (candidate) => candidate.method === 'post' && candidate.path === '/:id/restore'
    );
    if (!route) throw new Error('restore route not registered');
    const prisma = {
      competitor: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const req: any = {
      params: { id: 'competitor-outside-tenant' },
      user: { id: 'director-1', role: 'director' },
      app: { locals: { prisma } },
    };
    const res: any = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);

    await route.handler(req, res);

    expect(prisma.competitor.findFirst).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.competitor.update).not.toHaveBeenCalled();
  });
});

function findRoute(method: string, path: string) {
  const route = handlers.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`${method} ${path} not registered`);
  return route;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('GET /meta/belts tenant isolation', () => {
  it('scopes distinct belts to accessible competitors', async () => {
    const prisma = { competitor: { findMany: vi.fn().mockResolvedValue([{ belt: 'Blue' }]) } };
    const req: any = { user: { id: 'director-1', role: 'director' }, app: { locals: { prisma } } };
    const res = mockRes();
    await findRoute('get', '/meta/belts').handler(req, res);
    const where = prisma.competitor.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(JSON.stringify(where.AND)).toContain('organization-1');
    expect(res.json).toHaveBeenCalledWith(['Blue']);
  });
});

describe('GET /:id/history tenant isolation', () => {
  const competitor = { id: 'c1', firstName: 'A', lastName: 'B' };
  const ownHistory = [{ id: 'h1', eventType: 'sparring', placement: 1, matchesWon: 2, matchesLost: 0 }];
  const makePrisma = (totalHistory: number) => ({
    competitor: { findFirst: vi.fn().mockResolvedValue(competitor) },
    competitorHistory: {
      findMany: vi.fn().mockResolvedValue(ownHistory),
      count: vi.fn().mockResolvedValue(totalHistory),
    },
    competitorRating: { findMany: vi.fn().mockResolvedValue([{ eventType: 'sparring', rating: 1200 }]) },
  });

  it('limits history to accessible, non-deleted tournaments and omits ratings built from hidden history', async () => {
    const prisma = makePrisma(3);
    const req: any = { params: { id: 'c1' }, user: { id: 'director-1', role: 'director' }, app: { locals: { prisma } } };
    const res = mockRes();
    await findRoute('get', '/:id/history').handler(req, res);

    const historyWhere = prisma.competitorHistory.findMany.mock.calls[0][0].where;
    expect(historyWhere.competitorId).toBe('c1');
    expect(historyWhere.tournament.deletedAt).toBeNull();
    expect(JSON.stringify(historyWhere.tournament.AND)).toContain('organization-1');
    expect(prisma.competitorRating.findMany).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.history).toEqual(ownHistory);
    expect(body.stats.sparring.rating).toBeUndefined();
  });

  it('returns ratings when every history row is visible', async () => {
    const prisma = makePrisma(1);
    const req: any = { params: { id: 'c1' }, user: { id: 'director-1', role: 'director' }, app: { locals: { prisma } } };
    const res = mockRes();
    await findRoute('get', '/:id/history').handler(req, res);
    expect(res.json.mock.calls[0][0].stats.sparring.rating).toEqual({ eventType: 'sparring', rating: 1200 });
  });
});

describe('POST / competitor ownership', () => {
  it('resolves the owning organization at director level', async () => {
    const auth = await import('../middleware/auth.js');
    const prisma = {
      tournament: { count: vi.fn().mockResolvedValue(1) },
      competitor: { create: vi.fn().mockResolvedValue({ id: 'new' }) },
    };
    const req: any = {
      user: { id: 'director-1', role: 'director' },
      body: { firstName: 'A', lastName: 'B', gender: 'male', dateOfBirth: '2010-01-01', belt: 'white' },
      app: { locals: { prisma } },
    };
    await findRoute('post', '/').handler(req, mockRes());
    expect(auth.resolveTournamentScope).toHaveBeenCalledWith(req, prisma, 'director');
  });
});

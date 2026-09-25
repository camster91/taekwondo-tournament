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

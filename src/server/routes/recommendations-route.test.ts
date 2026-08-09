import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(), approveRecommendation: vi.fn(), rejectRecommendation: vi.fn(), getValidator: vi.fn(),
}));
const routeState = vi.hoisted(() => ({ captured: [] as Array<{ method: string; path: string; handler: any }> }));
vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  checkTournamentAccess: (...args: any[]) => mocks.checkTournamentAccess(...args),
}));
vi.mock('../services/recommendation-contract.js', () => ({
  approveRecommendation: (...args: any[]) => mocks.approveRecommendation(...args),
  rejectRecommendation: (...args: any[]) => mocks.rejectRecommendation(...args),
}));
vi.mock('../services/recommendation-validators.js', () => ({ getRecommendationValidator: (...args: any[]) => mocks.getValidator(...args) }));
vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post']) router[method] = (path: string, ...handlers: any[]) => {
    routeState.captured.push({ method, path, handler: handlers.at(-1) }); return router;
  };
  return { Router: () => router, default: { Router: () => router } };
});

import './recommendations';

const handler = (method: string, path: string) => routeState.captured.find((route) => route.method === method && route.path === path)!.handler;
const response = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((status: number) => { res.statusCode = status; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
};

describe('recommendation review routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not query recommendations when tournament access is denied', async () => {
    const prisma = { recommendation: { findMany: vi.fn() } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const res = response();
    await handler('get', '/tournament/:tournamentId')({ params: { tournamentId: 'foreign' }, app: { locals: { prisma } } }, res);
    expect(res.statusCode).toBe(403);
    expect(prisma.recommendation.findMany).not.toHaveBeenCalled();
  });

  it('binds approval to both the authorized tournament and recommendation ID', async () => {
    const prisma = { recommendation: { findFirst: vi.fn().mockResolvedValue(null) } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    const res = response();
    await handler('post', '/tournament/:tournamentId/:recommendationId/approve')({
      params: { tournamentId: 'own', recommendationId: 'foreign-rec' }, user: { id: 'director-1' }, app: { locals: { prisma } },
    }, res);
    expect(prisma.recommendation.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-rec', tournamentId: 'own' }, select: { id: true, recommendationType: true } });
    expect(res.statusCode).toBe(404);
    expect(mocks.approveRecommendation).not.toHaveBeenCalled();
  });

  it('fails closed when no server validator is registered for the recommendation type', async () => {
    const prisma = { recommendation: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', recommendationType: 'invented-ai-type' }) } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.getValidator.mockReturnValue(undefined);
    const res = response();
    await handler('post', '/tournament/:tournamentId/:recommendationId/approve')({ params: { tournamentId: 'own', recommendationId: 'rec-1' }, user: { id: 'director-1' }, app: { locals: { prisma } } }, res);
    expect(res.statusCode).toBe(409);
    expect(mocks.approveRecommendation).not.toHaveBeenCalled();
  });

  it('records the authenticated director identity for rejection', async () => {
    const prisma = { recommendation: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1' }) } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.rejectRecommendation.mockResolvedValue({ id: 'rec-1', status: 'rejected' });
    const res = response();
    await handler('post', '/tournament/:tournamentId/:recommendationId/reject')({
      params: { tournamentId: 'own', recommendationId: 'rec-1' }, user: { id: 'director-1' }, body: { reason: 'Unsafe' }, app: { locals: { prisma } },
    }, res);
    expect(mocks.rejectRecommendation).toHaveBeenCalledWith(prisma, 'rec-1', 'director-1', 'Unsafe');
    expect(res.body).toMatchObject({ status: 'rejected' });
  });
});

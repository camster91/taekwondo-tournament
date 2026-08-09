import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(), approveRecommendation: vi.fn(), rejectRecommendation: vi.fn(), getValidator: vi.fn(),
  createDivisionRecommendation: vi.fn(),
  applyDivisionRecommendation: vi.fn(),
  createScheduleOptimizationRecommendation: vi.fn(),
  applyScheduleOptimizationRecommendation: vi.fn(),
  undoScheduleOptimizationRecommendation: vi.fn(),
  saveScheduleOperationalConditions: vi.fn(),
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
vi.mock('../services/division-recommendations.js', () => ({
  DIVISION_RECOMMENDATION_TYPE: 'division_categorization_v1',
  createDivisionRecommendation: (...args: any[]) => mocks.createDivisionRecommendation(...args),
  applyDivisionRecommendation: (...args: any[]) => mocks.applyDivisionRecommendation(...args),
}));
vi.mock('../services/schedule-optimization-recommendations.js', () => ({
  SCHEDULE_OPTIMIZATION_TYPE: 'schedule_optimization_v1',
  createScheduleOptimizationRecommendation: (...args: any[]) => mocks.createScheduleOptimizationRecommendation(...args),
  applyScheduleOptimizationRecommendation: (...args: any[]) => mocks.applyScheduleOptimizationRecommendation(...args),
  undoScheduleOptimizationRecommendation: (...args: any[]) => mocks.undoScheduleOptimizationRecommendation(...args),
  saveScheduleOperationalConditions: (...args: any[]) => mocks.saveScheduleOperationalConditions(...args),
}));
vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'put']) router[method] = (path: string, ...handlers: any[]) => {
    routeState.captured.push({ method, path, handler: handlers.at(-1) }); return router;
  };
  return { Router: () => router, default: { Router: () => router } };
});

import { scheduleConditionsSchema } from './recommendations';

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

  it('creates a deterministic division proposal only for an authorized director', async () => {
    const prisma = {};
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.createDivisionRecommendation.mockResolvedValue({ id: 'rec-division', status: 'proposed' });
    const res = response();
    await handler('post', '/tournament/:tournamentId/divisions/propose')({
      params: { tournamentId: 'own' }, user: { id: 'director-1' }, body: {}, app: { locals: { prisma } },
    }, res);
    expect(mocks.createDivisionRecommendation).toHaveBeenCalledWith(prisma, 'own', 'director-1');
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 'rec-division', status: 'proposed' });
  });

  it('creates a server-resolved schedule proposal without accepting authoritative client arrays', async () => {
    const prisma = {};
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.createScheduleOptimizationRecommendation.mockResolvedValue({ id: 'rec-schedule', status: 'proposed' });
    const res = response();
    await handler('post', '/tournament/:tournamentId/schedule/propose')({
      params: { tournamentId: 'own' }, user: { id: 'director-1' },
      body: { divisions: [{ id: 'foreign-client-row' }], blockedRings: [99] }, app: { locals: { prisma } },
    }, res);
    expect(mocks.createScheduleOptimizationRecommendation).toHaveBeenCalledWith(prisma, 'own', 'director-1');
    expect(res.statusCode).toBe(201);
  });

  it('stores director-confirmed live conditions through the dedicated route', async () => {
    const prisma = {};
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.saveScheduleOperationalConditions.mockResolvedValue({ id: 'own' });
    const body = { restWindowMinutes: 10, ringDelays: [{ ring: 1, delayMinutes: 12 }], incidentBlocks: [] };
    const res = response();
    await handler('put', '/tournament/:tournamentId/schedule/conditions')({
      params: { tournamentId: 'own' }, user: { id: 'director-1' }, body, app: { locals: { prisma } },
    }, res);
    expect(mocks.saveScheduleOperationalConditions).toHaveBeenCalledWith(prisma, 'own', body);
    expect(res.body).toEqual({ ok: true });
  });

  it('does not let a director manufacture system telemetry provenance', async () => {
    expect(scheduleConditionsSchema.safeParse({
      restWindowMinutes: 10,
      ringDelays: [{ ring: 1, delayMinutes: 12, source: 'system-pace' }],
      incidentBlocks: [],
    }).success).toBe(false);
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

  it('applies a tournament-bound division recommendation with the authenticated director identity', async () => {
    const prisma = { recommendation: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', recommendationType: 'division_categorization_v1' }) } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.applyDivisionRecommendation.mockResolvedValue({ appliedResult: { divisions: 2 }, alreadyApplied: false });
    const res = response();
    await handler('post', '/tournament/:tournamentId/:recommendationId/apply')({
      params: { tournamentId: 'own', recommendationId: 'rec-1' }, user: { id: 'director-1' }, app: { locals: { prisma } },
    }, res);
    expect(mocks.applyDivisionRecommendation).toHaveBeenCalledWith(prisma, 'rec-1', 'director-1');
    expect(res.body).toMatchObject({ appliedResult: { divisions: 2 }, alreadyApplied: false });
  });

  it('applies a tournament-bound schedule recommendation through its exact workflow', async () => {
    const prisma = { recommendation: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-2', recommendationType: 'schedule_optimization_v1' }) } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    mocks.applyScheduleOptimizationRecommendation.mockResolvedValue({ appliedResult: { moved: 2 } });
    const res = response();
    await handler('post', '/tournament/:tournamentId/:recommendationId/apply')({
      params: { tournamentId: 'own', recommendationId: 'rec-2' }, user: { id: 'director-1' }, app: { locals: { prisma } },
    }, res);
    expect(mocks.applyScheduleOptimizationRecommendation).toHaveBeenCalledWith(prisma, 'rec-2', 'director-1');
    expect(res.body).toMatchObject({ appliedResult: { moved: 2 } });
  });

  it('undoes a tournament-bound applied schedule recommendation as the authenticated director', async () => {
    const prisma = { recommendation: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-2', recommendationType: 'schedule_optimization_v1' }) } };
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
    const res = response();
    await handler('post', '/tournament/:tournamentId/:recommendationId/undo')({
      params: { tournamentId: 'own', recommendationId: 'rec-2' }, user: { id: 'director-1' }, app: { locals: { prisma } },
    }, res);
    expect(mocks.undoScheduleOptimizationRecommendation).toHaveBeenCalledWith(prisma, 'own', 'rec-2', 'director-1');
    expect(res.body).toEqual({ ok: true });
  });
});

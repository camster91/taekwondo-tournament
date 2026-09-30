import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkTournamentAccess: vi.fn(), buildTournamentAccessFilter: vi.fn() }));
const routeState = vi.hoisted(() => ({ captured: [] as Array<{ method: string; path: string; handler: any }> }));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  checkTournamentAccess: (...args: any[]) => mocks.checkTournamentAccess(...args),
  buildTournamentAccessFilter: (...args: any[]) => mocks.buildTournamentAccessFilter(...args),
}));
vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (path: string, ...handlers: any[]) => {
    routeState.captured.push({ method, path, handler: handlers.at(-1) }); return router;
  };
  return { Router: () => router, default: { Router: () => router } };
});

import { createAssignmentSchema, updateAssignmentSchema } from './staffing';

const handler = (method: string, path: string) =>
  routeState.captured.find((route) => route.method === method && route.path === path)!.handler;
const response = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((status: number) => { res.statusCode = status; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  res.send = vi.fn(() => res);
  return res;
};

const director = { id: 'dir-1', role: 'director', email: 'd@example.test', firstName: 'D', lastName: 'Irector', isDemo: false };
const staffer = { id: 'u-1', firstName: 'Sam', lastName: 'Keeper', email: 's@example.test', role: 'scorekeeper' };
const settings = JSON.stringify({ schedule: { startTime: '08:00', endTime: '17:00', ringCount: 2 } });

function prismaFor(overrides: Record<string, any> = {}) {
  return {
    tournament: {
      findUnique: vi.fn().mockResolvedValue({ id: 't-1', name: 'Open', date: new Date(), settings, organizationId: 'org-1' }),
    },
    userTournamentAccess: { findMany: vi.fn().mockResolvedValue([]) },
    organizationMember: { findMany: vi.fn().mockResolvedValue([{ user: staffer }]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    staffAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: any) => ({ id: 'a-1', status: 'active', ...data, user: staffer })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tournamentOperationAudit: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

const request = (prisma: any, extra: Record<string, any> = {}) => ({
  user: director, params: { tournamentId: 't-1' }, body: {}, app: { locals: { prisma } }, ...extra,
});

describe('staffing schemas', () => {
  const valid = { userId: '5b7c3b8e-3f0a-4a53-9c8e-2c1f4f1a0b11', duty: 'scorekeeper', ringNumber: 1, startTime: '08:00', endTime: '12:00' };

  it('accepts a ring assignment and a venue-wide one', () => {
    expect(createAssignmentSchema.safeParse(valid).success).toBe(true);
    expect(createAssignmentSchema.safeParse({ ...valid, ringNumber: null, duty: 'check_in' }).success).toBe(true);
  });

  it('rejects bad times, reversed windows, unknown duties and long notes', () => {
    expect(createAssignmentSchema.safeParse({ ...valid, startTime: '8:00' }).success).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...valid, startTime: '12:00', endTime: '12:00' }).success).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...valid, duty: 'admin' }).success).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...valid, note: 'x'.repeat(201) }).success).toBe(false);
    expect(updateAssignmentSchema.safeParse({ ringNumber: 0 }).success).toBe(false);
  });
});

describe('staffing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkTournamentAccess.mockResolvedValue({ ok: true });
  });

  it('refuses the board to non-directors without touching assignments', async () => {
    const prisma = prismaFor();
    mocks.checkTournamentAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const res = response();
    await handler('get', '/tournament/:tournamentId')(request(prisma), res);
    expect(res.statusCode).toBe(403);
    expect(prisma.staffAssignment.findMany).not.toHaveBeenCalled();
    expect(mocks.checkTournamentAccess).toHaveBeenCalledWith(expect.anything(), prisma, 't-1', 'director');
  });

  it('returns coverage gaps for unstaffed rings and the eligible staff list', async () => {
    const prisma = prismaFor();
    const res = response();
    await handler('get', '/tournament/:tournamentId')(request(prisma), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.window).toEqual({ startTime: '08:00', endTime: '17:00', ringCount: 2 });
    expect(res.body.coverage.gaps).toHaveLength(2);
    expect(res.body.eligibleStaff).toEqual([staffer]);
  });

  it('only lists staff who pass the real access check', async () => {
    const prisma = prismaFor();
    mocks.checkTournamentAccess.mockImplementation(async (req: any) =>
      (req.user.id === staffer.id ? { ok: false, status: 403 } : { ok: true }));
    const res = response();
    await handler('get', '/tournament/:tournamentId')(request(prisma), res);
    expect(res.body.eligibleStaff).toEqual([]);
  });

  it('creates an assignment for eligible staff and audits it', async () => {
    const prisma = prismaFor();
    const res = response();
    await handler('post', '/tournament/:tournamentId/assignments')(request(prisma, {
      body: { userId: staffer.id, duty: 'scorekeeper', ringNumber: 2, startTime: '08:00', endTime: '12:00', note: '' },
    }), res);
    expect(res.statusCode).toBe(201);
    expect(prisma.staffAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tournamentId: 't-1', userId: staffer.id, ringNumber: 2, note: null, createdById: director.id }),
    }));
    expect(prisma.tournamentOperationAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operationType: 'staff_assignment_created', tournamentId: 't-1' }),
    }));
  });

  it('refuses a ring beyond the tournament ring count', async () => {
    const prisma = prismaFor();
    const res = response();
    await handler('post', '/tournament/:tournamentId/assignments')(request(prisma, {
      body: { userId: staffer.id, duty: 'scorekeeper', ringNumber: 3, startTime: '08:00', endTime: '12:00' },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(prisma.staffAssignment.create).not.toHaveBeenCalled();
  });

  it('refuses someone who cannot open the tournament', async () => {
    const prisma = prismaFor();
    const res = response();
    await handler('post', '/tournament/:tournamentId/assignments')(request(prisma, {
      body: { userId: 'outsider', duty: 'runner', ringNumber: null, startTime: '08:00', endTime: '12:00' },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/cannot open this tournament/);
    expect(prisma.staffAssignment.create).not.toHaveBeenCalled();
  });

  it('answers 404 for an assignment in a tournament the director cannot manage', async () => {
    const prisma = prismaFor();
    prisma.staffAssignment.findUnique.mockResolvedValue({ id: 'a-1', tournamentId: 'foreign', status: 'active' });
    mocks.checkTournamentAccess.mockResolvedValue({ ok: false, status: 403 });
    const res = response();
    await handler('post', '/assignments/:id/withdraw')(request(prisma, { params: { id: 'a-1' } }), res);
    expect(res.statusCode).toBe(404);
    expect(prisma.staffAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('withdraws once; a second withdraw is a 409', async () => {
    const prisma = prismaFor();
    prisma.staffAssignment.findUnique.mockResolvedValue({ id: 'a-1', tournamentId: 't-1', status: 'active' });
    const first = response();
    await handler('post', '/assignments/:id/withdraw')(request(prisma, { params: { id: 'a-1' } }), first);
    expect(first.statusCode).toBe(204);
    expect(first.send).toHaveBeenCalled();
    expect(prisma.staffAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a-1', status: 'active' },
      data: expect.objectContaining({ status: 'withdrawn', withdrawnById: director.id }),
    }));

    prisma.staffAssignment.updateMany.mockResolvedValue({ count: 0 });
    const second = response();
    await handler('post', '/assignments/:id/withdraw')(request(prisma, { params: { id: 'a-1' } }), second);
    expect(second.statusCode).toBe(409);
  });

  it('rejects an edit that would end before it starts', async () => {
    const prisma = prismaFor();
    prisma.staffAssignment.findUnique.mockResolvedValue({
      id: 'a-1', tournamentId: 't-1', status: 'active', duty: 'scorekeeper', ringNumber: 1, startTime: '08:00', endTime: '12:00', note: null,
    });
    const res = response();
    await handler('put', '/assignments/:id')(request(prisma, { params: { id: 'a-1' }, body: { endTime: '07:00' } }), res);
    expect(res.statusCode).toBe(400);
    expect(prisma.staffAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("returns only the caller's own active assignments on the run sheet", async () => {
    const prisma = prismaFor();
    const res = response();
    await handler('get', '/tournament/:tournamentId/mine')(request(prisma, { user: { ...director, id: 'u-1' } }), res);
    expect(prisma.staffAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tournamentId: 't-1', userId: 'u-1', status: 'active' },
    }));
    expect(mocks.checkTournamentAccess).toHaveBeenCalledWith(expect.anything(), prisma, 't-1', 'viewer');
  });

  it('scopes the cross-tournament run sheet to tournaments the caller can open', async () => {
    const prisma = prismaFor();
    mocks.buildTournamentAccessFilter.mockResolvedValue({ organizationId: { in: ['org-1'] } });
    const res = response();
    await handler('get', '/mine')(request(prisma, { user: { ...director, id: 'u-1' } }), res);
    expect(prisma.staffAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'u-1',
        status: 'active',
        tournament: { deletedAt: null, status: { not: 'completed' }, organizationId: { in: ['org-1'] } },
      },
    }));
  });
});

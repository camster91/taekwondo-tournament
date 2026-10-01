/**
 * Clone and restore both add a live tournament to an organization, so they
 * must respect the same plan limit as POST /api/tournaments (402
 * TOURNAMENT_LIMIT_REACHED). Clone also validates its body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';

vi.mock('../middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/auth.js')>()),
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { id: 'user-1', role: 'director', email: 'u@example.test', firstName: 'U', lastName: 'Ser', isDemo: false };
    next();
  },
}));

vi.mock('../services/audit-log.js', () => ({
  createAuditLog: vi.fn(async () => undefined),
  getClientIp: () => '127.0.0.1',
  getUserAgent: () => 'test',
}));

import tournamentsRouter from './tournaments.js';

const original = {
  id: 't-1',
  name: 'Spring Open',
  date: new Date('2026-05-01T12:00:00.000Z'),
  location: 'Gym',
  settings: null,
  sportProfileSlug: 'taekwondo',
  sportProfileId: null,
  organizationId: 'org-1',
  deletedAt: null as Date | null,
};

const prisma = {
  tournament: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn() },
  userTournamentAccess: { findUnique: vi.fn() },
  organizationMember: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  organization: { findUnique: vi.fn() },
  registration: { findMany: vi.fn(), createMany: vi.fn() },
  weightClass: { findMany: vi.fn(), createMany: vi.fn() },
  tournamentRule: { findMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
};

function makeApp() {
  const app = express();
  app.locals.prisma = prisma;
  app.use(express.json());
  app.use('/api/tournaments', tournamentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  original.deletedAt = null;
  prisma.tournament.findUnique.mockImplementation(async () => ({ ...original }));
  prisma.tournament.create.mockImplementation(async ({ data }) => ({ id: 't-2', ...data }));
  prisma.tournament.update.mockResolvedValue({});
  prisma.userTournamentAccess.findUnique.mockResolvedValue(null);
  prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });
  prisma.organization.findUnique.mockResolvedValue({ plan: 'free' });
  prisma.tournament.count.mockResolvedValue(0);
  prisma.weightClass.findMany.mockResolvedValue([]);
  prisma.tournamentRule.findMany.mockResolvedValue([]);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
});

describe('POST /api/tournaments/:id/clone', () => {
  it('clones when the organization is under its plan limit', async () => {
    const res = await request(makeApp()).post('/api/tournaments/t-1/clone').send({});
    expect(res.status).toBe(201);
    expect(prisma.tournament.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Spring Open (copy)', organizationId: 'org-1' }),
    }));
  });

  it('accepts a request with no body', async () => {
    const res = await request(makeApp()).post('/api/tournaments/t-1/clone');
    expect(res.status).toBe(201);
  });

  it('returns 402 and creates nothing when the plan limit is reached', async () => {
    prisma.tournament.count.mockResolvedValue(1); // free plan: 1 tournament
    const res = await request(makeApp()).post('/api/tournaments/t-1/clone').send({});
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('TOURNAMENT_LIMIT_REACHED');
    expect(prisma.tournament.create).not.toHaveBeenCalled();
    expect(prisma.tournament.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', deletedAt: null } });
  });

  it.each([
    [{ name: '' }],
    [{ name: '   ' }],
    [{ name: 'x'.repeat(201) }],
    [{ name: 42 }],
    [{ date: 'not-a-date' }],
    [{ date: 20270101 }],
    [{ includeRegistrations: 'yes' }],
  ])('rejects %j with 400', async (body) => {
    const res = await request(makeApp()).post('/api/tournaments/t-1/clone').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(prisma.tournament.create).not.toHaveBeenCalled();
  });

  it('uses a valid name and date from the body', async () => {
    const res = await request(makeApp())
      .post('/api/tournaments/t-1/clone')
      .send({ name: '  Fall Open  ', date: '2027-09-15', includeRegistrations: false });
    expect(res.status).toBe(201);
    const data = prisma.tournament.create.mock.calls[0][0].data;
    expect(data.name).toBe('Fall Open');
    expect(data.date.toISOString()).toBe('2027-09-15T12:00:00.000Z');
  });
});

describe('POST /api/tournaments/:id/restore', () => {
  beforeEach(() => {
    original.deletedAt = new Date('2026-06-01');
  });

  it('restores when the organization is under its plan limit', async () => {
    const res = await request(makeApp()).post('/api/tournaments/t-1/restore');
    expect(res.status).toBe(204);
    expect(prisma.tournament.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { deletedAt: null } });
  });

  it('returns 402 and keeps the tournament deleted when the plan limit is reached', async () => {
    prisma.tournament.count.mockResolvedValue(1);
    const res = await request(makeApp()).post('/api/tournaments/t-1/restore');
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('TOURNAMENT_LIMIT_REACHED');
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('does not apply an org plan limit to a legacy org-less tournament', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([]);
    prisma.organizationMember.count.mockResolvedValue(0);
    prisma.tournament.findUnique.mockImplementation(async () => ({ ...original, organizationId: null }));
    const res = await request(makeApp()).post('/api/tournaments/t-1/restore');
    expect(res.status).toBe(204);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';

vi.mock('../middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/auth.js')>()),
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { id: 'dir-1', role: 'director', email: 'd@example.test', firstName: 'D', lastName: 'Ir', isDemo: false };
    next();
  },
  checkTournamentAccess: vi.fn(async () => ({ ok: true })),
}));

import divisionsRouter from './divisions.js';

const prisma = {
  division: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  divisionAssignment: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  registration: { findUnique: vi.fn() },
  bracket: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
};

function makeApp() {
  const app = express();
  app.locals.prisma = prisma;
  app.use(express.json());
  app.use('/api/divisions', divisionsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const drawn = [{ id: 'd-src', name: 'Cadet Sparring', bracket: { _count: { matches: 7 } } }];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.division.findMany.mockResolvedValue([]);
  prisma.bracket.deleteMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
});

describe('roster changes under a drawn bracket (S6)', () => {
  it('DELETE /:id/assign/:assignmentId answers 409 ACTIVE_BRACKETS when the division has a bracket', async () => {
    prisma.divisionAssignment.findUnique.mockResolvedValue({ divisionId: 'd-src', division: { tournamentId: 't-1' } });
    prisma.division.findMany.mockResolvedValue(drawn);
    const res = await request(makeApp()).delete('/api/divisions/d-src/assign/a-1');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'ACTIVE_BRACKETS',
      activeBrackets: [{ divisionId: 'd-src', divisionName: 'Cadet Sparring', matchCount: 7 }],
    });
    expect(res.body.error).toMatch(/Cannot remove competitors from divisions with active brackets/);
    expect(prisma.divisionAssignment.delete).not.toHaveBeenCalled();
  });

  it('DELETE /:id/assign/:assignmentId still unassigns when there is no bracket', async () => {
    prisma.divisionAssignment.findUnique.mockResolvedValue({ divisionId: 'd-src', division: { tournamentId: 't-1' } });
    const res = await request(makeApp()).delete('/api/divisions/d-src/assign/a-1');
    expect(res.status).toBe(204);
    expect(prisma.divisionAssignment.delete).toHaveBeenCalledWith({ where: { id: 'a-1' } });
    // An unplayed bracket (no started match) is cleared with the change.
    expect(prisma.bracket.deleteMany).toHaveBeenCalledWith({ where: { divisionId: { in: ['d-src'] } } });
  });

  it('only a started bracket (a real match in progress or completed) blocks the change', async () => {
    prisma.divisionAssignment.findUnique.mockResolvedValue({ divisionId: 'd-src', division: { tournamentId: 't-1' } });
    await request(makeApp()).delete('/api/divisions/d-src/assign/a-1');
    const where = prisma.division.findMany.mock.calls[0][0].where;
    expect(where.bracket.is.matches.some).toEqual({
      status: { in: ['in_progress', 'completed'] },
      competitor1Id: { not: null },
      competitor2Id: { not: null },
    });
  });

  it('POST /:id/move checks both source and target divisions for brackets', async () => {
    prisma.divisionAssignment.findUnique.mockResolvedValue({ divisionId: 'd-src', division: { tournamentId: 't-1' } });
    prisma.division.findUnique.mockResolvedValue({ tournamentId: 't-1', deletedAt: null });
    prisma.division.findMany.mockResolvedValue([{ id: 'd-dst', name: 'Target', bracket: { _count: { matches: 3 } } }]);
    const res = await request(makeApp()).post('/api/divisions/d-src/move').send({ assignmentId: 'a-1', toDivisionId: 'd-dst' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACTIVE_BRACKETS');
    expect(prisma.division.findMany.mock.calls[0][0].where.id.in).toEqual(['d-src', 'd-dst']);
    expect(prisma.divisionAssignment.update).not.toHaveBeenCalled();
  });

  it('POST /:id/move moves when neither division has a bracket', async () => {
    prisma.divisionAssignment.findUnique.mockResolvedValue({ divisionId: 'd-src', division: { tournamentId: 't-1' } });
    prisma.division.findUnique.mockResolvedValue({ tournamentId: 't-1', deletedAt: null });
    prisma.divisionAssignment.update.mockResolvedValue({ id: 'a-1', divisionId: 'd-dst' });
    const res = await request(makeApp()).post('/api/divisions/d-src/move').send({ assignmentId: 'a-1', toDivisionId: 'd-dst' });
    expect(res.status).toBe(200);
    expect(prisma.divisionAssignment.update).toHaveBeenCalled();
    expect(prisma.bracket.deleteMany).toHaveBeenCalledWith({ where: { divisionId: { in: ['d-src', 'd-dst'] } } });
  });

  it('POST /:id/split refuses a division with a bracket', async () => {
    prisma.division.findUnique.mockResolvedValue({ id: 'd-src', name: 'Cadet Sparring', tournamentId: 't-1', assignments: [] });
    prisma.division.findMany.mockResolvedValue(drawn);
    const res = await request(makeApp()).post('/api/divisions/d-src/split').send({ splitCount: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACTIVE_BRACKETS');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.division.create).not.toHaveBeenCalled();
  });

  it('POST /:id/split runs inside one transaction', async () => {
    const assignments = [1, 2, 3, 4].map((n) => ({ id: `a-${n}` }));
    prisma.division.findUnique.mockResolvedValue({
      id: 'd-src', name: 'Cadet Sparring', tournamentId: 't-1', beltLevel: 'CB', gender: 'M', eventType: 'sparring',
      ageMin: 10, ageMax: 11, beltColors: null, danMin: null, danMax: null, weightClass: null, isSpecialNeeds: false, assignments,
    });
    prisma.division.create.mockResolvedValue({ id: 'd-new' });
    const res = await request(makeApp()).post('/api/divisions/d-src/split').send({ splitCount: 2 });
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.divisionAssignment.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'a-3' }, data: { divisionId: 'd-new' } },
      { where: { id: 'a-4' }, data: { divisionId: 'd-new' } },
    ]);
  });
});

describe('assign/move body validation (S7)', () => {
  it('POST /:id/assign without a string registrationId answers 400, not 500', async () => {
    for (const body of [{}, { registrationId: 42 }, { registrationId: '' }]) {
      const res = await request(makeApp()).post('/api/divisions/d-1/assign').send(body);
      expect(res.status).toBe(400);
    }
    expect(prisma.division.findUnique).not.toHaveBeenCalled();
  });

  it('POST /:id/move without string ids answers 400', async () => {
    for (const body of [{}, { assignmentId: 'a-1' }, { assignmentId: 1, toDivisionId: 'd-2' }]) {
      const res = await request(makeApp()).post('/api/divisions/d-1/move').send(body);
      expect(res.status).toBe(400);
    }
    expect(prisma.divisionAssignment.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /:id/assign conflict rule (S1)', () => {
  beforeEach(() => {
    prisma.division.findUnique.mockResolvedValue({ tournamentId: 't-1', eventType: 'sparring' });
    prisma.registration.findUnique.mockResolvedValue({ tournamentId: 't-1' });
  });

  it('only an assignment in a division of the same event type conflicts', async () => {
    prisma.divisionAssignment.findFirst.mockResolvedValue(null);
    prisma.divisionAssignment.create.mockResolvedValue({ id: 'a-new' });
    const res = await request(makeApp()).post('/api/divisions/d-1/assign').send({ registrationId: 'r-1' });
    expect(res.status).toBe(201);
    expect(prisma.divisionAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { registrationId: 'r-1', division: { eventType: 'sparring' } },
    }));
  });

  it('answers 409 when the registration is already in a division of that event type', async () => {
    prisma.divisionAssignment.findFirst.mockResolvedValue({ id: 'a-old', divisionId: 'd-2', division: { name: 'Other Sparring' } });
    const res = await request(makeApp()).post('/api/divisions/d-1/assign').send({ registrationId: 'r-1' });
    expect(res.status).toBe(409);
    expect(res.body.existingDivisionName).toBe('Other Sparring');
    expect(prisma.divisionAssignment.create).not.toHaveBeenCalled();
  });
});

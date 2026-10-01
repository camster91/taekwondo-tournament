import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';

const currentUser = vi.hoisted(() => ({ value: { id: 'user-1', role: 'director' } as { id: string; role: string } }));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/auth.js')>()),
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { ...currentUser.value, email: 'u@example.test', firstName: 'U', lastName: 'Ser', isDemo: false };
    next();
  },
}));

import tournamentsRouter, { isCheckInOnlyUpdate, normalizeTournamentDate } from './tournaments.js';

const prisma = {
  tournament: { findUnique: vi.fn(), create: vi.fn() },
  userTournamentAccess: { findUnique: vi.fn() },
  organizationMember: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  organization: { findUnique: vi.fn() },
  registration: { findFirst: vi.fn(), update: vi.fn() },
  tournamentTemplate: { findFirst: vi.fn() },
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

const putRegistration = (body: Record<string, unknown>) =>
  request(makeApp()).put('/api/tournaments/t-1/registrations/r-1').send(body);

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.value = { id: 'user-1', role: 'director' };
  prisma.tournament.findUnique.mockResolvedValue({ organizationId: 'org-1', deletedAt: null });
  prisma.userTournamentAccess.findUnique.mockResolvedValue(null);
  prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });
  prisma.registration.findFirst.mockResolvedValue({ id: 'r-1', tournamentId: 't-1', paymentReceivedAt: null });
  prisma.registration.update.mockImplementation(async ({ data }) => ({ id: 'r-1', ...data }));
});

describe('isCheckInOnlyUpdate', () => {
  it('accepts bodies limited to check-in fields', () => {
    expect(isCheckInOnlyUpdate({ checkedIn: true })).toBe(true);
    expect(isCheckInOnlyUpdate({ checkedIn: false, checkInTime: null, checkInWeight: null })).toBe(true);
  });

  it('rejects empty, non-object or mixed bodies', () => {
    expect(isCheckInOnlyUpdate({})).toBe(false);
    expect(isCheckInOnlyUpdate(null)).toBe(false);
    expect(isCheckInOnlyUpdate([])).toBe(false);
    expect(isCheckInOnlyUpdate({ checkedIn: true, paymentStatus: 'paid' })).toBe(false);
    expect(isCheckInOnlyUpdate({ checkedIn: true, unexpected: 1 })).toBe(false);
  });
});

describe('PUT /:id/registrations/:regId check-in payloads (C2)', () => {
  it('undo check-in clears checkedIn, checkInTime and checkInWeight', async () => {
    const res = await putRegistration({ checkedIn: false, checkInTime: null, checkInWeight: null });
    expect(res.status).toBe(200);
    expect(prisma.registration.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { checkedIn: false, checkInTime: null, checkInWeight: null },
    }));
  });

  it('bulk/offline check-in with a null weight and a client timestamp succeeds with a server timestamp', async () => {
    const res = await putRegistration({ checkedIn: true, checkInTime: new Date().toISOString(), checkInWeight: null });
    expect(res.status).toBe(200);
    const data = prisma.registration.update.mock.calls[0][0].data;
    expect(data.checkedIn).toBe(true);
    expect(data.checkInTime).toBeInstanceOf(Date);
    expect(data.checkInWeight).toBeNull();
  });

  it('still rejects a non-positive weight', async () => {
    const res = await putRegistration({ checkedIn: true, checkInWeight: -5 });
    expect(res.status).toBe(400);
  });
});

describe('PUT /:id/registrations/:regId role requirements (C4)', () => {
  it('lets a scorekeeper member check a competitor in', async () => {
    currentUser.value = { id: 'sk-1', role: 'scorekeeper' };
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'scorekeeper' });
    const res = await putRegistration({ checkedIn: true, checkInWeight: 60 });
    expect(res.status).toBe(200);
  });

  it('does not let a scorekeeper change non-check-in fields', async () => {
    currentUser.value = { id: 'sk-1', role: 'scorekeeper' };
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'scorekeeper' });
    const res = await putRegistration({ checkedIn: true, paymentStatus: 'paid' });
    expect(res.status).toBe(403);
    expect(prisma.registration.update).not.toHaveBeenCalled();
  });

  it('does not let a viewer check in', async () => {
    currentUser.value = { id: 'v-1', role: 'viewer' };
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'viewer' });
    const res = await putRegistration({ checkedIn: true });
    expect(res.status).toBe(403);
  });

  it('caps a global director with a viewer membership to read-only', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'viewer' });
    const res = await putRegistration({ checkedIn: true });
    expect(res.status).toBe(403);
  });
});

describe('tournament creation requires a director-level membership (T2)', () => {
  it('POST / rejects a director whose only memberships are viewer/scorekeeper', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { organizationId: 'org-y', role: 'viewer' },
      { organizationId: 'org-z', role: 'scorekeeper' },
    ]);
    const res = await request(makeApp()).post('/api/tournaments').send({ name: 'Cup', date: '2026-11-01' });
    expect(res.status).toBe(403);
    expect(prisma.tournament.create).not.toHaveBeenCalled();
  });

  it('POST / places the tournament in the first director-level membership org', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { organizationId: 'org-y', role: 'viewer' },
      { organizationId: 'org-own', role: 'owner' },
    ]);
    // Stop right after the org is resolved: the org lookup is the next step.
    prisma.organization.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).post('/api/tournaments').send({ name: 'Cup', date: '2026-11-01' });
    expect(res.status).toBe(404);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-own' } }));
  });

  it('POST /from-template/:templateId rejects viewer-only memberships', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([{ organizationId: 'org-y', role: 'viewer' }]);
    const res = await request(makeApp()).post('/api/tournaments/from-template/tpl-1').send({ name: 'Cup', date: '2026-11-01' });
    expect(res.status).toBe(403);
    expect(prisma.tournamentTemplate.findFirst).not.toHaveBeenCalled();
  });
});

describe('normalizeTournamentDate', () => {
  it('stores create and update dates at noon UTC on the picked calendar day', () => {
    expect(normalizeTournamentDate('2026-08-15').toISOString()).toBe('2026-08-15T12:00:00.000Z');
    // A full ISO timestamp (as an edit form may send) keeps its calendar
    // day instead of being stored at UTC midnight.
    expect(normalizeTournamentDate('2026-08-15T00:00:00.000Z').toISOString()).toBe('2026-08-15T12:00:00.000Z');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';

// T2: an organization membership's own role must gate org-level writes.
// A user with a global director role but only a viewer/scorekeeper
// membership must not manage that org's templates or custom domains.

vi.mock('../middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/auth.js')>()),
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { id: 'director-1', email: 'd@example.test', role: 'director', firstName: 'D', lastName: 'R', isDemo: false };
    next();
  },
}));

import templatesRouter from './tournament-templates.js';
import customDomainsRouter from './custom-domains.js';

const prisma = {
  organizationMember: { findMany: vi.fn(), findUnique: vi.fn() },
  tournamentTemplate: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  customDomain: { findMany: vi.fn(), findUnique: vi.fn() },
};

function makeApp() {
  const app = express();
  app.locals.prisma = prisma;
  app.use(express.json());
  app.use('/api/tournament-templates', templatesRouter);
  app.use('/api/custom-domains', customDomainsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.tournamentTemplate.findMany.mockResolvedValue([]);
  prisma.tournamentTemplate.create.mockImplementation(async ({ data }) => ({ id: 'tpl-1', ...data }));
  prisma.customDomain.findMany.mockResolvedValue([]);
});

describe('tournament templates', () => {
  it('rejects a director whose memberships are all below director level', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { organizationId: 'org-y', role: 'viewer' },
      { organizationId: 'org-z', role: 'scorekeeper' },
    ]);
    const list = await request(makeApp()).get('/api/tournament-templates');
    expect(list.status).toBe(403);
    const create = await request(makeApp()).post('/api/tournament-templates').send({ name: 'T' });
    expect(create.status).toBe(403);
    expect(prisma.tournamentTemplate.findMany).not.toHaveBeenCalled();
    expect(prisma.tournamentTemplate.create).not.toHaveBeenCalled();
  });

  it('uses the first director-level membership, skipping viewer ones', async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { organizationId: 'org-y', role: 'viewer' },
      { organizationId: 'org-own', role: 'admin' },
    ]);
    const create = await request(makeApp()).post('/api/tournament-templates').send({ name: 'T' });
    expect(create.status).toBe(201);
    expect(prisma.tournamentTemplate.create.mock.calls[0][0].data.organizationId).toBe('org-own');
  });
});

describe('custom domains', () => {
  it.each(['viewer', 'scorekeeper', 'director', 'member'])('denies a %s membership', async (role) => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role });
    const res = await request(makeApp()).get('/api/custom-domains/organization/org-1');
    expect(res.status).toBe(403);
    expect(prisma.customDomain.findMany).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('allows an %s membership', async (role) => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role });
    const res = await request(makeApp()).get('/api/custom-domains/organization/org-1');
    expect(res.status).toBe(200);
  });

  it('denies verifying another org domain with a viewer membership', async () => {
    prisma.customDomain.findUnique.mockResolvedValue({ id: 'd1', organizationId: 'org-1', status: 'pending' });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'viewer' });
    const res = await request(makeApp()).post('/api/custom-domains/d1/verify');
    expect(res.status).toBe(403);
  });
});

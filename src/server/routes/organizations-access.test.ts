import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: [] as Array<{ method: string; path: string; handler: any }>,
}));

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'delete'] as const) {
    router[method] = (path: string, ...args: any[]) => {
      mocks.handlers.push({ method, path, handler: args.at(-1) });
      return router;
    };
  }
  return { Router: vi.fn(() => router) };
});

vi.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  PrismaClient: class {},
}));
vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/entitlements.js', () => ({
  getPlanEntitlements: vi.fn(() => ({ publicRegistration: false })),
}));
vi.mock('../services/organization-closure.js', () => ({
  validateOrganizationDeletion: vi.fn(),
}));
vi.mock('./organizations-validation.js', () => ({
  normalizeOrganizationCreateInput: vi.fn(),
  normalizePlanChangeInput: vi.fn(),
}));

import './organizations.js';

const handler = (method: string, path: string) => {
  const route = mocks.handlers.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Missing ${method.toUpperCase()} ${path} route`);
  return route.handler;
};

const response = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((statusCode: number) => { res.statusCode = statusCode; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  res.setHeader = vi.fn();
  res.send = vi.fn();
  return res;
};

describe('organization response boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not expose secret-bearing settings to an ordinary organization member', async () => {
    const secret = 'synthetic-provider-key-never-return';
    const prisma: any = {
      organizationMember: {
        findMany: vi.fn().mockResolvedValue([{
          role: 'member',
          organization: {
            id: 'org-a',
            name: 'Synthetic Dojang',
            slug: 'synthetic-dojang',
            plan: 'free',
            settings: JSON.stringify({
              marker: 'safe-setting',
              supportIntegration: { openAiApiKey: secret, openAiModel: 'synthetic-model' },
            }),
            billingSubscription: null,
            _count: { members: 2, tournaments: 1 },
          },
        }]),
      },
    };
    const req: any = {
      user: { id: 'member-a', role: 'viewer' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('get', '/current')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.organizations[0]).not.toHaveProperty('settings');
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });
});

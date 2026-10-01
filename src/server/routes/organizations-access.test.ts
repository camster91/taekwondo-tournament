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
vi.mock('../services/stripe-billing.js', () => ({
  expireOpenCheckoutSessions: vi.fn(),
  stripeRuntimeConfigFromEnv: vi.fn(() => ({ secretKey: 'sk_test', webhookSecret: 'whsec', prices: {} })),
}));
vi.mock('stripe', () => ({ default: class {} }));
vi.mock('./organizations-validation.js', () => ({
  normalizeOrganizationCreateInput: vi.fn(),
  normalizePlanChangeInput: vi.fn(),
}));

import './organizations.js';
import { validateOrganizationDeletion } from '../services/organization-closure.js';
import { expireOpenCheckoutSessions } from '../services/stripe-billing.js';

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

describe('organization creation adopts the creator\'s org-less tournaments', () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = async (role: string) => {
    const { normalizeOrganizationCreateInput } = await import('./organizations-validation.js');
    vi.mocked(normalizeOrganizationCreateInput).mockReturnValue({
      ok: true,
      data: { name: 'Synthetic Dojang', slug: 'synthetic-dojang' },
    } as never);
    const tx: any = {
      organization: { create: vi.fn().mockResolvedValue({ id: 'org-new', name: 'Synthetic Dojang', plan: 'free', settings: null }) },
      organizationMember: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
      tournament: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma: any = {
      organizationMember: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const req: any = { user: { id: 'director-a', role }, body: {}, app: { locals: { prisma } } };
    const res = response();
    await handler('post', '/')(req, res);
    return { tx, res };
  };

  it('moves only tournaments the director created that have no organization', async () => {
    const { tx, res } = await setup('director');
    expect(res.statusCode).toBe(201);
    expect(tx.tournament.updateMany).toHaveBeenCalledWith({
      where: { createdById: 'director-a', organizationId: null },
      data: { organizationId: 'org-new' },
    });
    expect(res.body.adoptedTournamentCount).toBe(2);
  });

  it('does not move anything when an admin creates an organization', async () => {
    const { tx, res } = await setup('admin');
    expect(res.statusCode).toBe(201);
    expect(tx.tournament.updateMany).not.toHaveBeenCalled();
    expect(res.body.adoptedTournamentCount).toBe(0);
  });
});

describe('organization deletion closes open Stripe checkouts first', () => {
  beforeEach(() => vi.clearAllMocks());

  const deletionRequest = () => {
    const prisma: any = {
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue({
          role: 'owner',
          organization: {
            id: 'org-a',
            slug: 'org-a',
            billingSubscription: { status: 'inactive', providerCustomerId: 'cus_1', providerSubscriptionId: null },
          },
        }),
      },
      tournament: { count: vi.fn().mockResolvedValue(0) },
      competitor: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const req: any = {
      params: { id: 'org-a' },
      body: { confirmation: 'org-a', exportAcknowledged: true },
      user: { id: 'owner-a', role: 'director' },
      app: { locals: { prisma } },
    };
    return { prisma, req };
  };

  it('expires the customer\'s open checkout sessions before deleting', async () => {
    vi.mocked(validateOrganizationDeletion).mockReturnValue({ ok: true });
    vi.mocked(expireOpenCheckoutSessions).mockResolvedValue(1);
    const { prisma, req } = deletionRequest();
    const res = response();
    await handler('delete', '/:id')(req, res);
    expect(expireOpenCheckoutSessions).toHaveBeenCalledWith(expect.anything(), 'cus_1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('refuses with 503 and deletes nothing when Stripe cannot be reached', async () => {
    vi.mocked(validateOrganizationDeletion).mockReturnValue({ ok: true });
    vi.mocked(expireOpenCheckoutSessions).mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { prisma, req } = deletionRequest();
    const res = response();
    await handler('delete', '/:id')(req, res);
    expect(res.statusCode).toBe(503);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

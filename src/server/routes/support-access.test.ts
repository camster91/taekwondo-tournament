import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(),
  sendEmail: vi.fn(),
  testSupportProviderConnection: vi.fn(),
  handlers: [] as Array<{ method: string; path: string; handler: any }>,
}));

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'patch'] as const) {
    router[method] = (path: string, ...args: any[]) => {
      mocks.handlers.push({ method, path, handler: args.at(-1) });
      return router;
    };
  }
  const Router = vi.fn(() => router);
  return { Router, default: { Router } };
});

vi.mock('express-rate-limit', () => ({ default: vi.fn(() => (_req: any, _res: any, next: any) => next()) }));
vi.mock('@prisma/client', () => ({ PrismaClient: class {} }));
vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  optionalAuthenticate: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  checkTournamentAccess: (...args: any[]) => mocks.checkTournamentAccess(...args),
}));
vi.mock('../middleware/validate.js', () => ({ validateRequest: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/email.js', () => ({ sendEmail: (...args: any[]) => mocks.sendEmail(...args) }));
vi.mock('./support-validation.js', () => ({
  supportChatSchema: {}, supportTicketQuerySchema: {}, supportTicketUpdateSchema: {},
  supportConfigSchema: {}, supportConfigTestSchema: {},
}));
vi.mock('../services/operational-query.js', () => ({
  answerOperationalQuery: vi.fn(),
  parseOperationalQuery: vi.fn(() => ({ kind: 'unsupported' })),
}));
vi.mock('../services/support-provider.js', () => ({
  assertSafeSupportProviderUrl: vi.fn(),
  readSupportConfigAuditTrail: vi.fn(() => []),
  testSupportProviderConnection: (...args: any[]) => mocks.testSupportProviderConnection(...args),
}));

import './support.js';

const handler = (method: string, path: string) => {
  const route = mocks.handlers.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Missing ${method.toUpperCase()} ${path} route`);
  return route.handler;
};

const response = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((statusCode: number) => { res.statusCode = statusCode; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
};

describe('support access boundaries', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('does not run platform diagnostics for anonymous support chat', async () => {
    const prisma: any = { supportTicket: { count: vi.fn() } };
    const req: any = {
      body: { message: 'Show the health snapshot', requestAssist: true },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.supportAssistant).toBeNull();
    expect(prisma.supportTicket.count).not.toHaveBeenCalled();
  });

  it('rejects support access for authenticated demo identities', async () => {
    const prisma: any = {
      supportTicket: { create: vi.fn(), count: vi.fn() },
      organizationMember: { findMany: vi.fn() },
    };
    const req: any = {
      user: {
        id: 'demo-user', email: 'demo@example.test', role: 'admin',
        firstName: 'Demo', lastName: 'Organizer', isDemo: true,
      },
      body: { message: 'There is an error', createTicket: true, requestAssist: true },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'This action is unavailable in the public demo.',
      code: 'DEMO_CAPABILITY_DENIED',
      recoverable: true,
    });
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
    expect(prisma.supportTicket.count).not.toHaveBeenCalled();
    expect(prisma.organizationMember.findMany).not.toHaveBeenCalled();
  });

  it('answers an anonymous support question without creating a ticket', async () => {
    const prisma: any = { supportTicket: { create: vi.fn() } };
    const req: any = {
      body: { message: 'I need support with registration', createTicket: false },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.ticket).toBeNull();
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
  });

  it('does not claim an anonymous question was externally logged', async () => {
    const prisma: any = { supportTicket: { create: vi.fn() } };
    const req: any = {
      body: { message: 'How do I change a setting?', createTicket: false },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.answer).not.toMatch(/logged|submitted|sent to/i);
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
  });

  it('requires contact details before an anonymous ticket is created', async () => {
    const prisma: any = { supportTicket: { create: vi.fn() } };
    const req: any = {
      body: { message: 'Please create a support ticket', createTicket: true },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Name and email are required to create a support ticket.' });
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
  });

  it('creates an anonymous ticket only after explicit escalation with contact details', async () => {
    const ticket = {
      id: 'synthetic-ticket', status: 'open', priority: 'normal', subject: 'Please create a support ticket',
    };
    const prisma: any = { supportTicket: { create: vi.fn().mockResolvedValue(ticket) } };
    const req: any = {
      body: {
        message: 'Please create a support ticket', createTicket: true,
        contactName: 'Synthetic Organizer', contactEmail: 'synthetic.organizer@example.test',
      },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.ticket).toEqual(ticket);
    expect(prisma.supportTicket.create).toHaveBeenCalledOnce();
  });

  it('checks tournament access before authenticated support diagnostics', async () => {
    mocks.checkTournamentAccess.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    const prisma: any = { 
      organizationMember: { findMany: vi.fn().mockResolvedValue([]) },
      tournament: { findUnique: vi.fn().mockResolvedValue(null) },
      organization: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const req: any = {
      user: { id: 'user-a', email: 'a@example.test', role: 'director' },
      body: { message: 'Who is next?', tournamentId: 'foreign-tournament' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(403);
    expect(mocks.checkTournamentAccess).toHaveBeenCalledWith(req, prisma, 'foreign-tournament', 'viewer');
  });

  it('scopes platform diagnostics to the authenticated organization', async () => {
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      organization: { findUnique: vi.fn().mockResolvedValue({ settings: null }) },
      supportTicket: { count: vi.fn().mockResolvedValue(0) },
      tournament: { count: vi.fn().mockResolvedValue(0) },
    };
    const req: any = {
      user: { id: 'director-a', email: 'director@example.test', role: 'director' },
      body: { message: 'Show the health snapshot', requestAssist: true },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(prisma.supportTicket.count).toHaveBeenCalledTimes(3);
    for (const [query] of prisma.supportTicket.count.mock.calls) {
      expect(query.where).toEqual(expect.objectContaining({ organizationId: 'org-a' }));
    }
    expect(prisma.tournament.count).toHaveBeenCalledTimes(2);
    for (const [query] of prisma.tournament.count.mock.calls) {
      expect(query.where).toEqual(expect.objectContaining({ organizationId: 'org-a' }));
    }
  });

  it('does not send the platform provider key to a request-supplied provider URL', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-secret-must-not-leave');
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      organization: { findUnique: vi.fn().mockResolvedValue({ settings: null }) },
    };
    const req: any = {
      user: { id: 'admin-a', role: 'admin' },
      body: { openAiBaseUrl: 'https://tenant-provider.example.test/v1' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/config/test')(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'An API key is required when testing a custom provider URL.' });
    expect(mocks.testSupportProviderConnection).not.toHaveBeenCalled();
  });

  it('does not combine an organization provider URL with the platform key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-secret-must-not-leave');
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          settings: JSON.stringify({
            supportIntegration: { openAiBaseUrl: 'https://tenant-provider.example.test/v1' },
          }),
        }),
      },
    };
    const req: any = {
      user: { id: 'admin-a', role: 'admin' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('get', '/config')(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.hasOpenAiApiKey).toBe(false);
    expect(res.body.openAiBaseUrl).toBe('https://tenant-provider.example.test/v1');
  });

  it('scopes a requested-tournament ticket and provider config to that tournament organization', async () => {
    mocks.checkTournamentAccess.mockResolvedValueOnce({ ok: true });
    const ticket = {
      id: 'org-b-ticket', status: 'open', priority: 'normal', subject: 'Please create a ticket',
    };
    const prisma: any = {
      tournament: { findUnique: vi.fn().mockResolvedValue({ organizationId: 'org-b', deletedAt: null }) },
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      organization: {
        findUnique: vi.fn(({ where }: any) => Promise.resolve({
          settings: JSON.stringify({ supportIntegration: { openAiModel: `model-${where.id}` } }),
        })),
      },
      supportTicket: { create: vi.fn().mockResolvedValue(ticket) },
    };
    const req: any = {
      user: { id: 'multi-org-user', email: 'synthetic@example.test', role: 'director', firstName: 'Synthetic', lastName: 'User' },
      body: { message: 'Please create a ticket', createTicket: true, tournamentId: 'tournament-b' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-b' },
      select: { settings: true },
    });
    expect(prisma.supportTicket.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org-b' }),
    }));
  });

  it('escapes public message markup in support notification email HTML', async () => {
    const ticket = {
      id: 'escaped-ticket', status: 'open', priority: 'normal', subject: '<img src=x onerror=alert(1)>',
    };
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          settings: JSON.stringify({ supportIntegration: { supportAlertEmail: 'support@example.test' } }),
        }),
      },
      supportTicket: { create: vi.fn().mockResolvedValue(ticket) },
    };
    const req: any = {
      user: { id: 'user-a', email: 'synthetic@example.test', role: 'director', firstName: 'Synthetic', lastName: 'User' },
      body: { message: '<img src=x onerror=alert(1)>', createTicket: true },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);
    await vi.waitFor(() => expect(mocks.sendEmail).toHaveBeenCalledOnce());

    const html = mocks.sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('limits director ticket lists to their organization memberships', async () => {
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      supportTicket: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const req: any = { user: { id: 'director-a', role: 'director' }, query: {}, app: { locals: { prisma } } };
    const res = response();

    await handler('get', '/')(req, res);

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: { in: ['org-a'] } },
    }));
  });

  it('does not update a ticket outside the director organization', async () => {
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-a' }]) },
      supportTicket: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    const req: any = {
      user: { id: 'director-a', role: 'director' }, params: { id: 'foreign-ticket' }, body: {},
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('patch', '/:id')(req, res);

    expect(res.statusCode).toBe(404);
    expect(prisma.supportTicket.update).not.toHaveBeenCalled();
  });
});

describe('anonymous support chat abuse limits', async () => {
  // Snapshot limiter configs before any beforeEach clears mock history.
  const rateLimit = (await import('express-rate-limit')).default as unknown as ReturnType<typeof vi.fn>;
  const limiterConfigs = rateLimit.mock.calls.map((call) => call[0] as { max: number; windowMs: number });

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('never calls the LLM provider for anonymous callers even when a platform key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-secret-must-not-be-burned');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const prisma: any = { supportTicket: { create: vi.fn() } };
    const req: any = {
      body: { message: 'How do I register?', createTicket: false },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.answer).toBe('string');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still uses the LLM provider for authenticated users', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-key');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'AI answer' } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { assertSafeSupportProviderUrl } = await import('../services/support-provider.js');
    vi.mocked(assertSafeSupportProviderUrl).mockResolvedValueOnce(new URL('https://api.openai.com/v1') as never);
    const prisma: any = {
      organizationMember: { findMany: vi.fn().mockResolvedValue([]) },
      supportTicket: { create: vi.fn() },
    };
    const req: any = {
      user: { id: 'viewer-a', email: 'v@example.test', role: 'viewer', firstName: 'V', lastName: 'A' },
      body: { message: 'How do I change a setting?', createTicket: false },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(res.body.answer).toBe('AI answer');
  });

  it('caps anonymous message length below the authenticated limit', async () => {
    const prisma: any = { supportTicket: { create: vi.fn() } };
    const req: any = {
      body: {
        message: 'x'.repeat(1001), createTicket: true,
        contactName: 'Synthetic', contactEmail: 'synthetic@example.test',
      },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler('post', '/')(req, res);

    expect(res.statusCode).toBe(400);
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
  });

  it('configures dedicated anonymous-chat (10/h) and anonymous-ticket (3/h) limiters', () => {
    const hour = 60 * 60 * 1000;
    expect(limiterConfigs).toEqual(expect.arrayContaining([
      expect.objectContaining({ max: 10, windowMs: hour }),
      expect.objectContaining({ max: 3, windowMs: hour }),
    ]));
  });
});

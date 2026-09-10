import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const invalidateAuthCache = vi.hoisted(() => vi.fn());

vi.mock('../middleware/auth.js', () => ({
  createToken: vi.fn(() => 'mock-jwt-token'),
  authenticate: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: req.headers['x-user-id'], email: req.headers['x-user-email'], role: 'admin' };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  SESSION_COOKIE: 'bowin_session',
  SESSION_COOKIE_OPTIONS: {},
  setCsrfCookie: vi.fn(),
  invalidateAuthCache,
  // SH-3: the demo user creation in src/server/routes/auth.ts now
  // imports DEMO_ORG_ID and DEMO_ROLE to construct the scoped demo
  // principal. Mirror the same values the real middleware exports
  // so the mock doesn't fall over.
  DEMO_ORG_ID: '00000000-0000-4000-8000-000000000001',
  DEMO_ROLE: 'demo',
}));

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}));

const originalEnv = { ...process.env };
const servers: Server[] = [];

async function startAuthServer(options: {
  nodeEnv: string;
  isolatedData?: string;
  enableDemo?: string;
  update?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  process.env.NODE_ENV = options.nodeEnv;
  if (options.enableDemo === undefined) process.env.ENABLE_DEMO_LOGIN = '1';
  else process.env.ENABLE_DEMO_LOGIN = options.enableDemo;
  if (options.isolatedData === undefined) delete process.env.DEMO_ISOLATED_DATA;
  else process.env.DEMO_ISOLATED_DATA = options.isolatedData;
  process.env.RATE_LIMIT_DISABLED = '1';

  const update = options.update ?? vi.fn().mockResolvedValue({});
  const findMany = options.findMany ?? vi.fn().mockResolvedValue([]);
  const deleteMany = options.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 });
  const create = vi.fn().mockImplementation(({ data, include }: { data: any; include?: any }) => {
    const user = {
      ...data,
      id: 'unique-demo-user',
      tokenVersion: 0,
    };
    // Mirror the nested-write the route now uses to create the
    // OrganizationMember so anything that consumes `user.organizationMembers`
    // after `prisma.user.create` resolves still sees the membership.
    if (include?.organizationMembers) {
      user.organizationMembers = [{ organizationId: data.organizationMembers?.create?.organizationId }];
    }
    return Promise.resolve(user);
  });
  const { default: authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    user: {
      update,
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue({
        id: 'demo-user',
        email: 'demo@bowin.app',
        firstName: 'Demo',
        lastName: 'Visitor',
        role: 'admin',
        tokenVersion: 0,
      }),
      create,
      findMany,
      deleteMany,
    },
    // SH-3: the demo login now fails closed when the synthetic
    // tenant (Organization with id DEMO_ORG_ID) is missing. Default
    // the mock to "present" so the existing tests keep exercising
    // the success path; tests that need the missing-org branch
    // override this directly.
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' }),
    },
  };
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { baseUrl: `http://127.0.0.1:${address.port}/api/auth`, update, create, findMany, deleteMany };
}

beforeEach(() => {
  process.env = { ...originalEnv };
  invalidateAuthCache.mockReset();
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  process.env = { ...originalEnv };
});

describe('demo session isolation', () => {
  it('uses standard token invalidation even for the legacy shared demo identity', async () => {
    const { baseUrl, update } = await startAuthServer({ nodeEnv: 'test' });

    const response = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { 'x-user-id': 'demo-user', 'x-user-email': 'demo@bowin.app' },
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'demo-user' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(invalidateAuthCache).toHaveBeenCalledWith('demo-user');
    expect(response.headers.get('set-cookie')).toContain('bowin_session=');
    expect(response.headers.get('set-cookie')).toContain('bowin_csrf=');
  });

  it('continues to bump tokenVersion for normal-user logout', async () => {
    const { baseUrl, update } = await startAuthServer({ nodeEnv: 'test' });

    const response = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { 'x-user-id': 'normal-user', 'x-user-email': 'person@example.com' },
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'normal-user' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(invalidateAuthCache).toHaveBeenCalledWith('normal-user');
    expect(response.headers.get('set-cookie')).toContain('bowin_session=');
    expect(response.headers.get('set-cookie')).toContain('bowin_csrf=');
  });

  it('hides demo login in production without isolated-data attestation', async () => {
    const { baseUrl } = await startAuthServer({ nodeEnv: 'production' });
    expect((await fetch(`${baseUrl}/demo`, { method: 'POST' })).status).toBe(404);
    expect(await (await fetch(`${baseUrl}/setup-status`)).json()).toMatchObject({
      needsSetup: false,
      demoLoginEnabled: false,
    });
  });

  it('exposes demo login in production with isolated-data attestation', async () => {
    const { baseUrl } = await startAuthServer({ nodeEnv: 'production', isolatedData: '1' });
    const response = await fetch(`${baseUrl}/demo`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: expect.stringMatching(/synthetic demo/i),
    });
    expect(await (await fetch(`${baseUrl}/setup-status`)).json()).toMatchObject({
      needsSetup: false,
      demoLoginEnabled: true,
    });
  });

  it('hides demo login in production when login opt-in is disabled despite isolated data', async () => {
    const { baseUrl } = await startAuthServer({
      nodeEnv: 'production',
      isolatedData: '1',
      enableDemo: '0',
    });
    expect((await fetch(`${baseUrl}/demo`, { method: 'POST' })).status).toBe(404);
  });

  it('writes the explicit expiry marker on each demo principal', async () => {
    const beforeLogin = Date.now();
    const { baseUrl, create } = await startAuthServer({ nodeEnv: 'test' });

    expect((await fetch(`${baseUrl}/demo`, { method: 'POST' })).status).toBe(200);

    const expiresAt = create.mock.calls[0][0].data.demoExpiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(beforeLogin + (4 * 60 * 60 * 1000));
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + (4 * 60 * 60 * 1000));
  });

  it('selects a capped oldest-first batch by explicit expiry marker and protected relations', async () => {
    const expired = [{ id: 'expired-1' }, { id: 'expired-2' }];
    const beforeLogin = Date.now();
    const { baseUrl, findMany, deleteMany } = await startAuthServer({
      nodeEnv: 'test',
      findMany: vi.fn().mockResolvedValue(expired),
    });

    expect((await fetch(`${baseUrl}/demo`, { method: 'POST' })).status).toBe(200);
    await vi.waitFor(() => expect(deleteMany).toHaveBeenCalledOnce());

    expect(findMany).toHaveBeenCalledOnce();
    const query = findMany.mock.calls[0][0];
    // SH-3: the safety predicate moved from "no org members at all"
    // to "every org member is the synthetic demo tenant". Real
    // tenants' principals never match this predicate, so a leaked
    // demo account can never sweep up a customer's user record.
    expect(query).toMatchObject({
      where: {
        demoExpiresAt: { lt: expect.any(Date) },
        tournamentAccess: { none: {} },
        organizationMembers: { every: { organizationId: '00000000-0000-4000-8000-000000000001' } },
      },
      orderBy: { demoExpiresAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    expect(query.where).not.toHaveProperty('email');
    expect(query.where.demoExpiresAt.lt.getTime()).toBeGreaterThanOrEqual(beforeLogin);
    expect(query.where.demoExpiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['expired-1', 'expired-2'] },
        demoExpiresAt: { lt: query.where.demoExpiresAt.lt },
        tournamentAccess: { none: {} },
        organizationMembers: { every: { organizationId: '00000000-0000-4000-8000-000000000001' } },
      },
    });
  });

  it('does not issue a delete when no expired principals are selected', async () => {
    const { baseUrl, findMany, deleteMany } = await startAuthServer({ nodeEnv: 'test' });

    expect((await fetch(`${baseUrl}/demo`, { method: 'POST' })).status).toBe(200);
    await vi.waitFor(() => expect(findMany).toHaveBeenCalledOnce());
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('continues demo login when bounded cleanup fails without logging PII', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { baseUrl } = await startAuthServer({
      nodeEnv: 'test',
      findMany: vi.fn().mockRejectedValue(new Error('database included person@example.com')),
    });

    expect((await fetch(`${baseUrl}/demo`, { method: 'POST' })).status).toBe(200);
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('Demo principal cleanup failed; continuing login.');
    });
    expect(warning.mock.calls.flat().join(' ')).not.toContain('person@example.com');
    warning.mockRestore();
  });
});

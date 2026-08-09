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
}) {
  vi.resetModules();
  process.env.NODE_ENV = options.nodeEnv;
  if (options.enableDemo === undefined) process.env.ENABLE_DEMO_LOGIN = '1';
  else process.env.ENABLE_DEMO_LOGIN = options.enableDemo;
  if (options.isolatedData === undefined) delete process.env.DEMO_ISOLATED_DATA;
  else process.env.DEMO_ISOLATED_DATA = options.isolatedData;
  process.env.RATE_LIMIT_DISABLED = '1';

  const update = options.update ?? vi.fn().mockResolvedValue({});
  const { default: authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    user: {
      update,
      findUnique: vi.fn().mockResolvedValue({
        id: 'demo-user',
        email: 'demo@bowin.app',
        firstName: 'Demo',
        lastName: 'Visitor',
        role: 'admin',
        tokenVersion: 0,
      }),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => Promise.resolve({
        ...data,
        id: 'unique-demo-user',
        tokenVersion: 0,
      })),
    },
  };
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { baseUrl: `http://127.0.0.1:${address.port}/api/auth`, update };
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
  });

  it('exposes demo login in production with isolated-data attestation', async () => {
    const { baseUrl } = await startAuthServer({ nodeEnv: 'production', isolatedData: '1' });
    const response = await fetch(`${baseUrl}/demo`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: expect.stringMatching(/synthetic demo/i),
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
});

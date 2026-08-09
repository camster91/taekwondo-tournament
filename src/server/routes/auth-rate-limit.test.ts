import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('../middleware/auth.js', () => ({
  createToken: vi.fn(() => 'mock-jwt-token'),
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  SESSION_COOKIE: 'bowin_session',
  SESSION_COOKIE_OPTIONS: {},
  setCsrfCookie: vi.fn(),
  invalidateAuthCache: vi.fn(),
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

async function startAuthServer(demoMax?: string) {
  vi.resetModules();
  process.env.ENABLE_DEMO_LOGIN = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.RATE_LIMIT_DISABLED;
  if (demoMax === undefined) delete process.env.DEMO_RATE_LIMIT_MAX;
  else process.env.DEMO_RATE_LIMIT_MAX = demoMax;

  const { default: authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    user: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockImplementation(({ where: { email } }) =>
        Promise.resolve({
          id: email === 'demo@bowin.app' ? 'demo-user' : 'magic-user',
          email,
          firstName: 'Demo',
          lastName: 'Visitor',
          role: email === 'demo@bowin.app' ? 'admin' : 'viewer',
          tokenVersion: 0,
        }),
      ),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
        ...data,
        id: `demo-${data.email}`,
        tokenVersion: 0,
      })),
    },
    magicLink: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return `http://127.0.0.1:${address.port}/api/auth`;
}

async function post(url: string, body?: object) {
  return fetch(url, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  process.env = { ...originalEnv };
});

describe('demo authentication rate limiting', () => {
  it('allows at least ten demo entries with the default capacity', async () => {
    const baseUrl = await startAuthServer();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(`${baseUrl}/demo`)),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
  });

  it('uses an independent configurable bucket and returns retry metadata', async () => {
    const baseUrl = await startAuthServer('5');

    for (let visitor = 0; visitor < 5; visitor += 1) {
      expect((await post(`${baseUrl}/demo`)).status).toBe(200);
    }

    const limitedDemo = await post(`${baseUrl}/demo`);
    expect(limitedDemo.status).toBe(429);
    expect(limitedDemo.headers.get('ratelimit-limit')).toBe('5');
    expect(limitedDemo.headers.get('retry-after')).toBeTruthy();
    expect(await limitedDemo.json()).toMatchObject({
      error: expect.stringMatching(/demo/i),
      retryAfterSeconds: expect.any(Number),
    });

    const magicLink = await post(`${baseUrl}/request-magic-link`, {
      email: 'visitor@example.com',
    });
    expect(magicLink.status).toBe(200);
  });
});

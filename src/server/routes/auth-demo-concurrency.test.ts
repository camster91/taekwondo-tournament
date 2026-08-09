import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}));

describe('concurrent demo sessions with real auth middleware', () => {
  let server: Server;
  let baseUrl: string;
  const originalEnv = { ...process.env };
  const demoUser = {
    id: 'real-demo-user',
    email: 'demo@bowin.app',
    firstName: 'Demo',
    lastName: 'Visitor',
    role: 'admin',
    isActive: true,
    tokenVersion: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastLogin: null,
    tournamentAccess: [],
  };

  beforeAll(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEMO_LOGIN = '1';
    process.env.RATE_LIMIT_DISABLED = '1';

    const { default: authRouter } = await import('./auth.js');
    const app = express();
    app.use(express.json());
    app.locals.prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(demoUser),
        create: vi.fn(),
        update: vi.fn().mockImplementation(() => {
          demoUser.tokenVersion += 1;
          return Promise.resolve(demoUser);
        }),
      },
    };
    app.use('/api/auth', authRouter);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/auth`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = { ...originalEnv };
  });

  it('keeps visitor B authenticated after visitor A logs out', async () => {
    const loginA = await fetch(`${baseUrl}/demo`, { method: 'POST' });
    const tokenA = (await loginA.json() as { token: string }).token;

    // JWT iat has one-second resolution; wait so the independently issued
    // session has a demonstrably distinct signed token.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const loginB = await fetch(`${baseUrl}/demo`, { method: 'POST' });
    const tokenB = (await loginB.json() as { token: string }).token;
    expect(tokenB).not.toBe(tokenA);

    const logoutA = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(logoutA.status).toBe(200);

    const meB = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(meB.status).toBe(200);
    expect(await meB.json()).toMatchObject({
      id: demoUser.id,
      email: demoUser.email,
      role: demoUser.role,
    });
  });
});

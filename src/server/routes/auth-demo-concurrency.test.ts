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
  const users = new Map<string, any>();
  const sharedDemoUser = {
    id: 'shared-demo-user', email: 'demo@bowin.app', firstName: 'Demo', lastName: 'Visitor',
    role: 'admin', isActive: true, tokenVersion: 0, createdAt: new Date(), lastLogin: null,
    tournamentAccess: [],
  };
  users.set(sharedDemoUser.id, sharedDemoUser);

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
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return Promise.resolve(users.get(where.id) ?? null);
          return Promise.resolve([...users.values()].find((user) => user.email === where.email) ?? null);
        }),
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const user = {
            ...data,
            id: `demo-user-${users.size}`,
            isActive: true,
            tokenVersion: 0,
            createdAt: new Date(),
            lastLogin: null,
            tournamentAccess: [],
          };
          users.set(user.id, user);
          return Promise.resolve(user);
        }),
        update: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          const user = users.get(where.id);
          user.tokenVersion += 1;
          return Promise.resolve(user);
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

  it('revokes visitor A without affecting independently identified visitor B', async () => {
    const loginA = await fetch(`${baseUrl}/demo`, { method: 'POST' });
    const sessionA = await loginA.json() as { token: string; user: { id: string } };
    const loginB = await fetch(`${baseUrl}/demo`, { method: 'POST' });
    const sessionB = await loginB.json() as { token: string; user: { id: string } };
    expect(sessionB.user.id).not.toBe(sessionA.user.id);
    expect(sessionB.token).not.toBe(sessionA.token);

    const logoutA = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionA.token}` },
    });
    expect(logoutA.status).toBe(200);

    const meA = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${sessionA.token}` },
    });
    expect(meA.status).toBe(401);

    const meB = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${sessionB.token}` },
    });
    expect(meB.status).toBe(200);
    expect(await meB.json()).toMatchObject({
      id: sessionB.user.id,
      role: 'admin',
    });
  });
});

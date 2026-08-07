import { describe, expect, it, vi } from 'vitest';

const routes = vi.hoisted(() => [] as Array<{
  method: string;
  path: string;
  handler: (...args: any[]) => any;
}>);

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path: string, ...callbacks: any[]) => {
      routes.push({ method, path, handler: callbacks.at(-1) });
      return router;
    };
  }
  return { Router: () => router };
});

vi.mock('express-rate-limit', () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(() => false),
}));
vi.mock('../services/email-templates.js', () => ({ escapeHtml: (value: string) => value }));

import './public.js';

function route(path: string) {
  const found = routes.find((candidate) => candidate.method === 'get' && candidate.path === path);
  if (!found) throw new Error(`route ${path} not registered`);
  return found.handler;
}

function response() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('public scoreboard access lifecycle', () => {
  it('hides a soft-deleted tournament when accessed by its public slug', async () => {
    const prisma = {
      tournament: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tournament-1',
          publicSlug: 'current-key',
          deletedAt: new Date(),
        }),
      },
      division: { findMany: vi.fn() },
    };
    const req: any = {
      params: { publicSlug: 'current-key' },
      app: { locals: { prisma } },
    };
    const res = response();

    await route('/scoreboard/:publicSlug')(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.division.findMany).not.toHaveBeenCalled();
  });

  it('rejects a rotated share key on the UUID scoreboard endpoint', async () => {
    const prisma = {
      tournament: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tournament-1',
          publicSlug: 'new-key',
          settings: null,
          deletedAt: null,
        }),
      },
      division: { findMany: vi.fn() },
    };
    const req: any = {
      params: { id: 'tournament-1' },
      query: { key: 'old-key' },
      app: { locals: { prisma } },
    };
    const res = response();

    await route('/tournaments/:id/scoreboard')(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.division.findMany).not.toHaveBeenCalled();
  });
});

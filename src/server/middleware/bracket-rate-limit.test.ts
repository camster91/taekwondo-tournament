import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';
import {
  BRACKET_REBUILD_MAX,
  BRACKET_WRITE_MAX,
  bracketRateLimitKey,
  createBracketRebuildLimiter,
  createBracketWriteLimiter,
} from './bracket-rate-limit.js';
import type { AuthenticatedRequest } from './auth.js';
import type { RateLimitRequestHandler } from 'express-rate-limit';

function fakeRequest(user: { id: string } | undefined, ip: string): { ip: string; user?: AuthenticatedRequest['user'] } {
  return {
    ip,
    user: user && { id: user.id, email: 'x@example.test', role: 'scorekeeper', firstName: 'A', lastName: 'B', isDemo: false },
  };
}

/** Minimal app: a fake `authenticate` reads x-user-id, then the limiter. */
function appWith(limiter: RateLimitRequestHandler) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string') {
      (req as AuthenticatedRequest).user = {
        id: userId, email: `${userId}@example.test`, role: 'scorekeeper', firstName: 'A', lastName: 'B', isDemo: false,
      };
    }
    next();
  });
  app.post('/write', limiter, (_req: Request, res: Response) => { res.json({ ok: true }); });
  return app;
}

describe('bracketRateLimitKey', () => {
  it('keys on the authenticated user so scorekeepers behind one venue NAT do not share a bucket', () => {
    expect(bracketRateLimitKey(fakeRequest({ id: 'u1' }, '203.0.113.5'))).toBe('user:u1');
    expect(bracketRateLimitKey(fakeRequest({ id: 'u2' }, '203.0.113.5'))).toBe('user:u2');
  });

  it('falls back to the client IP when no user is attached', () => {
    expect(bracketRateLimitKey(fakeRequest(undefined, '203.0.113.5'))).toBe('ip:203.0.113.5');
  });

  it('groups IPv6 clients by subnet so address rotation cannot dodge the cap', () => {
    const a = bracketRateLimitKey(fakeRequest(undefined, '2001:db8:1:1::1'));
    const b = bracketRateLimitKey(fakeRequest(undefined, '2001:db8:1:1::2'));
    expect(a).toBe(b);
  });
});

describe('bracket write limiters (production enforcement)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('caps whole-bracket rebuilds per user and returns 429 with a JSON error', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = appWith(createBracketRebuildLimiter());

    for (let i = 0; i < BRACKET_REBUILD_MAX; i++) {
      await request(app).post('/write').set('x-user-id', 'director-1').expect(200);
    }
    const blocked = await request(app).post('/write').set('x-user-id', 'director-1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many bracket rebuilds/);
    expect(blocked.headers['ratelimit-policy']).toBeDefined();

    // A different user in the same venue still has budget.
    await request(app).post('/write').set('x-user-id', 'director-2').expect(200);
  });

  it('caps match-level writes per user at the higher write budget', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = appWith(createBracketWriteLimiter());

    const results = await Promise.all(
      Array.from({ length: BRACKET_WRITE_MAX + 1 }, () =>
        request(app).post('/write').set('x-user-id', 'scorekeeper-1').then((r) => r.status),
      ),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(BRACKET_WRITE_MAX);
    expect(results.filter((s) => s === 429)).toHaveLength(1);
  });

  it('is bypassed in test environments outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = appWith(createBracketRebuildLimiter());

    for (let i = 0; i < BRACKET_REBUILD_MAX + 2; i++) {
      await request(app).post('/write').set('x-user-id', 'director-1').expect(200);
    }
  });
});

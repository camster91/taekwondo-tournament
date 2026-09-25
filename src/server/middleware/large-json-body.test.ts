/**
 * Regression tests for the large-JSON-body mount used by index.ts:
 * - authentication/role checks run BEFORE the 40 MB parser
 * - /api/competitors/import actually gets the larger limit (previously the
 *   global 1 MB parser rejected it first with 413)
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createToken } from './auth.js';
import { mountLargeJsonBodyRoutes } from './large-json-body.js';

function buildApp(role: string) {
  const app = express();
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    email: `${where.id}@example.test`,
    role,
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    tokenVersion: 0,
    demoExpiresAt: null,
  }));
  app.locals.prisma = { user: { findUnique } };
  app.use(cookieParser());
  mountLargeJsonBodyRoutes(app);
  app.use(express.json({ limit: '1mb' }));
  const echo = (req: express.Request, res: express.Response) => {
    res.json({ bytes: JSON.stringify(req.body ?? {}).length });
  };
  app.post('/api/competitors/import', echo);
  app.post('/api/competitors/auto-map', echo);
  app.post('/api/other', echo);
  return { app, findUnique };
}

const twoMegabyteBody = { fileBase64: 'A'.repeat(2 * 1024 * 1024), columnMapping: {} };

function tokenFor(userId: string, role: string) {
  return createToken({ userId, email: `${userId}@example.test`, role, tokenVersion: 0 });
}

describe('mountLargeJsonBodyRoutes', () => {
  it('rejects anonymous callers with 401 before parsing a large body', async () => {
    const { app } = buildApp('admin');
    for (const path of ['/api/competitors/import', '/api/competitors/auto-map']) {
      const res = await request(app).post(path).send(twoMegabyteBody);
      expect(res.status).toBe(401);
    }
  });

  it('rejects low-privilege callers with 403 before parsing a large body', async () => {
    const { app } = buildApp('viewer');
    const res = await request(app)
      .post('/api/competitors/import')
      .set('Authorization', `Bearer ${tokenFor('viewer-1', 'viewer')}`)
      .send(twoMegabyteBody);
    expect(res.status).toBe(403);
  });

  it('accepts >1 MB bodies on import and auto-map for directors', async () => {
    const { app } = buildApp('director');
    const token = tokenFor('director-1', 'director');
    for (const path of ['/api/competitors/import', '/api/competitors/auto-map']) {
      const res = await request(app).post(path).set('Authorization', `Bearer ${token}`).send(twoMegabyteBody);
      expect(res.status).toBe(200);
      expect(res.body.bytes).toBeGreaterThan(2 * 1024 * 1024);
    }
  });

  it('keeps the 1 MB limit on other routes', async () => {
    const { app } = buildApp('director');
    const res = await request(app)
      .post('/api/other')
      .set('Authorization', `Bearer ${tokenFor('director-2', 'director')}`)
      .send(twoMegabyteBody);
    expect(res.status).toBe(413);
  });
});

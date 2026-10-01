/**
 * /register, /checkout and /verify-parent-consent each have their own rate
 * limit budget. They used to share one limiter (10 per 15 min per IP
 * combined), so a family registering several children could lock itself
 * out of paying or confirming consent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

async function buildApp() {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  delete process.env.RATE_LIMIT_DISABLED;
  delete process.env.VITEST; // let the limiters run
  const { default: publicRouter } = await import('./public.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = {};
  app.use('/api/public', publicRouter);
  return app;
}

describe('public write rate limits', () => {
  it('exhausting /register does not block checkout or consent confirmation', async () => {
    const app = await buildApp();
    for (let i = 0; i < 10; i += 1) {
      // Invalid body: rejected by validation, but still counted.
      expect((await request(app).post('/api/public/register').send({})).status).toBe(400);
    }
    expect((await request(app).post('/api/public/register').send({})).status).toBe(429);

    expect((await request(app).post('/api/public/checkout').send({})).status).toBe(400);
    expect((await request(app).post('/api/public/verify-parent-consent').send({})).status).toBe(400);
  });
});

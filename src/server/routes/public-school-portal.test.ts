/**
 * Express already percent-decodes route params. The school portal decoded
 * :schoolName a second time, so a school called "100% TKD" (sent once-
 * encoded as 100%25%20TKD) threw URIError and returned 500.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.RATE_LIMIT_DISABLED = '1';
const { default: publicRouter } = await import('./public.js');

describe('GET /api/public/tournaments/:id/school/:schoolName', () => {
  it('handles a school name containing a literal percent sign', async () => {
    const findMany = vi.fn(async () => []);
    const app = express();
    app.locals.prisma = {
      tournament: {
        findUnique: vi.fn(async () => ({
          id: 't-1', name: 'Open', date: new Date('2030-01-01'), location: null, status: 'registration',
          sportProfileSlug: 'taekwondo', deletedAt: null, publicSlug: 'slug-1',
        })),
      },
      registration: { findMany },
    };
    app.use('/api/public', publicRouter);

    const res = await request(app).get(`/api/public/tournaments/t-1/school/${encodeURIComponent('100% TKD')}?slug=slug-1`);
    expect(res.status).toBe(200);
    expect(res.body.schoolName).toBe('100% TKD');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitor: { schoolDojang: { equals: '100% TKD', mode: 'insensitive' } },
      }),
    }));
  });
});

/**
 * On a verified custom domain for org A the portal must only serve org A.
 * Requests for another organization's slug through that host fail closed
 * exactly like an unknown slug.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import publicPortalRouter from './public-portal.js';

describe('portal routes on a custom domain', () => {
  let app: Express;
  let findUnique: ReturnType<typeof vi.fn>;

  function build(customDomain: Record<string, unknown> | null) {
    app = express();
    app.use(express.json());
    app.locals.prisma = { organization: { findUnique }, tournament: { findMany: vi.fn(async () => []) } };
    app.use((_req: Request, res: Response, next: NextFunction) => {
      if (customDomain) res.locals.customDomain = customDomain;
      next();
    });
    app.use('/api/public/portal', publicPortalRouter);
  }

  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = '1';
    findUnique = vi.fn(async () => ({
      id: 'org-b-id', name: 'Org B', slug: 'org-b', brandName: null, brandPrimaryColor: null, brandLogoUrl: null, tournaments: [],
    }));
    build({ resolvedOrgId: 'org-a-id', resolvedOrgSlug: 'org-a', isCustomDomain: true });
  });

  it('does not list another organization’s events', async () => {
    const res = await request(app).get('/api/public/portal/org-b');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ organization: null, events: [] });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('404s another organization’s event page and registration', async () => {
    expect((await request(app).get('/api/public/portal/org-b/spring-open')).status).toBe(404);
    const register = await request(app).post('/api/public/portal/org-b/spring-open/register').send({});
    expect(register.status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('still serves the domain’s own organization', async () => {
    await request(app).get('/api/public/portal/org-a');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'org-a' } }));
  });

  it('serves any organization on the default app host', async () => {
    build(null);
    await request(app).get('/api/public/portal/org-b');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'org-b' } }));
  });
});

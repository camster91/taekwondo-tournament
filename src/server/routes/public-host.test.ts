/**
 * GET /api/public/host: the SPA asks which organizer owns the host so an
 * organizer's custom domain opens on their own events. The answer must come
 * only from an active custom domain and must carry no ids or private data.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import publicHostRouter from './public-host.js';
import publicRouter from './public.js';
import { resolveCustomDomainHost } from '../middleware/custom-domain-host.js';

describe('GET /api/public/host', () => {
  let app: Express;
  let customDomainFind: ReturnType<typeof vi.fn>;
  let organizationFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = '1';
    process.env.PUBLIC_APP_URL = 'https://app.bowin.test';
    customDomainFind = vi.fn(async ({ where }: { where: { hostname: string } }) => {
      if (where.hostname === 'register.newton.test') {
        return { status: 'active', organizationId: 'org-a-id', organization: { slug: 'newton-tkd' } };
      }
      if (where.hostname === 'pending.newton.test') {
        return { status: 'pending', organizationId: 'org-a-id', organization: { slug: 'newton-tkd' } };
      }
      return null;
    });
    organizationFind = vi.fn(async () => ({
      slug: 'newton-tkd',
      name: 'Newton Taekwondo Inc.',
      plan: 'pro',
      brandName: 'Newton TKD',
      brandPrimaryColor: '#1D4ED8',
      brandLogoUrl: '/logos/newton.png',
    }));
    app = express();
    app.locals.prisma = {
      customDomain: { findUnique: customDomainFind },
      organization: { findUnique: organizationFind },
    };
    app.use(resolveCustomDomainHost({ cacheTtlMs: 0 }));
    app.use('/api/public/host', publicHostRouter);
  });

  it('names the organizer that owns an active custom domain', async () => {
    const res = await request(app).get('/api/public/host').set('Host', 'register.newton.test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      organization: {
        slug: 'newton-tkd',
        name: 'Newton TKD',
        brandPrimaryColor: '#1D4ED8',
        brandLogoUrl: '/logos/newton.png',
      },
      hidePlatformBranding: true,
    });
    expect(organizationFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-a-id' } }));
    // No ids, plan names or anything private.
    expect(JSON.stringify(res.body)).not.toContain('org-a-id');
    expect(JSON.stringify(res.body)).not.toContain('"plan"');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps bowin branding for an organizer on a free plan', async () => {
    organizationFind.mockResolvedValueOnce({
      slug: 'newton-tkd', name: 'Newton Taekwondo', plan: 'free', brandName: null, brandPrimaryColor: null, brandLogoUrl: null,
    });
    const res = await request(app).get('/api/public/host').set('Host', 'register.newton.test');
    expect(res.body).toEqual({
      organization: { slug: 'newton-tkd', name: 'Newton Taekwondo', brandPrimaryColor: '#DC2626', brandLogoUrl: null },
      hidePlatformBranding: false,
    });
  });

  it('answers null on the default app host without a lookup', async () => {
    const res = await request(app).get('/api/public/host').set('Host', 'app.bowin.test');
    expect(res.body).toEqual({ organization: null, hidePlatformBranding: false });
    expect(customDomainFind).not.toHaveBeenCalled();
    expect(organizationFind).not.toHaveBeenCalled();
  });

  it('answers null for an unknown host', async () => {
    const res = await request(app).get('/api/public/host').set('Host', 'someone-else.test');
    expect(res.body).toEqual({ organization: null, hidePlatformBranding: false });
    expect(organizationFind).not.toHaveBeenCalled();
  });

  it('lists only the domain owner’s open tournaments on a custom domain', async () => {
    const findMany = vi.fn(async () => []);
    const listApp = express();
    listApp.locals.prisma = {
      customDomain: { findUnique: customDomainFind },
      tournament: { findMany },
    };
    listApp.use(resolveCustomDomainHost({ cacheTtlMs: 0 }));
    listApp.use('/api/public', publicRouter);

    await request(listApp).get('/api/public/tournaments').set('Host', 'register.newton.test');
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-a-id' }),
    }));

    await request(listApp).get('/api/public/tournaments').set('Host', 'app.bowin.test');
    const [args] = findMany.mock.calls.at(-1) as unknown as [{ where: Record<string, unknown> }];
    expect(args.where).not.toHaveProperty('organizationId');
  });

  it('refuses a domain that is not active yet', async () => {
    const res = await request(app).get('/api/public/host').set('Host', 'pending.newton.test');
    expect(res.status).toBe(404);
    expect(organizationFind).not.toHaveBeenCalled();
  });
});

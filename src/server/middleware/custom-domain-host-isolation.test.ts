/**
 * Regression tests: custom-domain resolution is per-request (res.locals),
 * never process-global (app.locals), and DB lookups are cached (including
 * negative results for unknown hosts) and skipped for static assets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolveCustomDomainHost, getResolvedOrg, isStaticAssetPath } from './custom-domain-host.js';

function buildApp(findUnique: ReturnType<typeof vi.fn>, options?: Parameters<typeof resolveCustomDomainHost>[0]) {
  const app = express();
  app.locals.prisma = { customDomain: { findUnique } };
  app.use(resolveCustomDomainHost(options));
  app.get('*', (req, res) => {
    res.json({ resolved: getResolvedOrg(res), appLocals: req.app.locals.customDomain ?? null });
  });
  return app;
}

const activeDomain = {
  status: 'active',
  organizationId: 'org-a',
  organization: { slug: 'org-a-slug' },
};

describe('resolveCustomDomainHost', () => {
  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.example.test';
  });

  it('stores the resolved org per request and never on app.locals', async () => {
    const findUnique = vi.fn(async ({ where }: { where: { hostname: string } }) =>
      where.hostname === 'tenant-a.example.org' ? activeDomain : null);
    const app = buildApp(findUnique);

    const tenant = await request(app).get('/api/public/portal/x').set('Host', 'tenant-a.example.org');
    expect(tenant.body.resolved).toEqual({ resolvedOrgId: 'org-a', resolvedOrgSlug: 'org-a-slug', isCustomDomain: true });
    expect(tenant.body.appLocals).toBeNull();

    // A later request on the main domain must not inherit tenant A.
    const main = await request(app).get('/api/public/portal/x').set('Host', 'app.example.test');
    expect(main.body.resolved).toBeNull();
    expect(main.body.appLocals).toBeNull();

    // Nor must a request on an unrelated host.
    const other = await request(app).get('/api/public/portal/x').set('Host', 'unknown.example.net');
    expect(other.body.resolved).toBeNull();
  });

  it('caches unknown-host misses so repeated requests do not hit the DB', async () => {
    const findUnique = vi.fn(async () => null);
    const app = buildApp(findUnique);

    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/public/tournaments').set('Host', 'random-host.example.net');
    }
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('expires cached lookups after the TTL', async () => {
    let now = 1_000;
    const findUnique = vi.fn(async () => null);
    const app = buildApp(findUnique, { cacheTtlMs: 100, now: () => now });

    await request(app).get('/api/x').set('Host', 'h.example.net');
    now += 50;
    await request(app).get('/api/x').set('Host', 'h.example.net');
    expect(findUnique).toHaveBeenCalledTimes(1);
    now += 100;
    await request(app).get('/api/x').set('Host', 'h.example.net');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('bounds the cache size', async () => {
    const findUnique = vi.fn(async () => null);
    const app = buildApp(findUnique, { maxCacheEntries: 2 });
    await request(app).get('/api/x').set('Host', 'a.example.net');
    await request(app).get('/api/x').set('Host', 'b.example.net');
    await request(app).get('/api/x').set('Host', 'c.example.net'); // evicts a
    await request(app).get('/api/x').set('Host', 'a.example.net');
    expect(findUnique).toHaveBeenCalledTimes(4);
  });

  it('skips DB lookups for static asset paths', async () => {
    const findUnique = vi.fn(async () => activeDomain);
    const app = buildApp(findUnique);
    await request(app).get('/assets/index-abc123.js').set('Host', 'tenant-a.example.org');
    await request(app).get('/favicon.ico').set('Host', 'tenant-a.example.org');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('still fails closed for inactive domains (and caches that too)', async () => {
    const findUnique = vi.fn(async () => ({ ...activeDomain, status: 'revoked' }));
    const app = buildApp(findUnique);
    const first = await request(app).get('/api/public/portal/x').set('Host', 'revoked.example.org');
    const second = await request(app).get('/api/public/portal/x').set('Host', 'revoked.example.org');
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('classifies static asset paths', () => {
    expect(isStaticAssetPath('/assets/app.js')).toBe(true);
    expect(isStaticAssetPath('/logo.png')).toBe(true);
    expect(isStaticAssetPath('/api/public/tournaments')).toBe(false);
    expect(isStaticAssetPath('/events/org/event')).toBe(false);
  });
});

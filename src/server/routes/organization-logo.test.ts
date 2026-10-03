import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';

const fsMock = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));

vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('fs', () => ({ existsSync: () => true, default: { existsSync: () => true } }));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
  orgMembershipRoleLevel: (await importOriginal<typeof import('../middleware/auth.js')>()).orgMembershipRoleLevel,
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { id: 'director-1', email: 'd@example.test', role: 'director', firstName: 'D', lastName: 'R', isDemo: false };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import path from 'path';
import logoRouter, { LOGO_RESPONSE_HEADERS, LOGO_STORAGE_PATH, resolveLogoStoragePath, setLogoResponseHeaders } from './organization-logo.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"><script>alert(1)</script></svg>');

const prisma = {
  organization: {
    findUnique: vi.fn(async () => ({ id: 'org-1', slug: 'acme', brandLogoUrl: null })),
    update: vi.fn(async () => ({})),
  },
  organizationMember: {
    findUnique: vi.fn(async () => ({ role: 'owner' })),
  },
};

function makeApp() {
  const app = express();
  app.locals.prisma = prisma;
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/organizations', logoRouter);
  return app;
}

const upload = (body: Record<string, unknown>) =>
  request(makeApp()).post('/api/organizations/org-1/logo-base64').send(body);

describe('POST /api/organizations/:orgId/logo-base64', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a real PNG with an extension derived from the bytes', async () => {
    const res = await upload({ data: PNG.toString('base64'), mimeType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/logos\/acme-[0-9a-f]{16}\.png$/);
    expect(fsMock.writeFile).toHaveBeenCalledOnce();
  });

  it('ignores a misleading declared type and uses the sniffed one', async () => {
    const res = await upload({ data: `data:image/png;base64,${JPEG.toString('base64')}`, mimeType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/\.jpg$/);
  });

  it('accepts a payload without a declared mimeType', async () => {
    const res = await upload({ data: PNG.toString('base64') });
    expect(res.status).toBe(200);
  });

  it('rejects a declared SVG upload with 415 and writes nothing', async () => {
    const res = await upload({ data: SVG.toString('base64'), mimeType: 'image/svg+xml' });
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/SVG is not accepted/);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects SVG bytes disguised as image/png (magic-byte check)', async () => {
    const res = await upload({ data: SVG.toString('base64'), mimeType: 'image/png' });
    expect(res.status).toBe(415);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('rejects SVG smuggled in a data: URL with a raster label', async () => {
    const res = await upload({ data: `data:image/png;base64,${SVG.toString('base64')}` });
    expect(res.status).toBe(415);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('rejects HTML disguised as an image', async () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    const res = await upload({ data: html.toString('base64'), mimeType: 'image/gif' });
    expect(res.status).toBe(415);
  });

  it('rejects malformed base64 instead of decoding garbage', async () => {
    const res = await upload({ data: '<svg onload=alert(1)>', mimeType: 'image/png' });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('refuses scorekeeper/viewer org memberships (branding is director-level)', async () => {
    for (const role of ['viewer', 'scorekeeper']) {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({ role });
      const res = await upload({ data: PNG.toString('base64'), mimeType: 'image/png' });
      expect(res.status).toBe(403);
    }
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('allows ordinary (member) and director-level memberships', async () => {
    for (const role of ['member', 'director', 'admin', 'owner']) {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({ role });
      const res = await upload({ data: PNG.toString('base64'), mimeType: 'image/png' });
      expect(res.status).toBe(200);
    }
  });

  it('rejects a non-string mimeType', async () => {
    const res = await upload({ data: PNG.toString('base64'), mimeType: ['image/png'] });
    expect(res.status).toBe(415);
  });
});

describe('setLogoResponseHeaders', () => {
  it('serves logos with nosniff and a sandboxed, script-free CSP', () => {
    const headers = new Map<string, string>();
    setLogoResponseHeaders({ setHeader: (name, value) => headers.set(name, value) });
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    const csp = headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox');
    expect(csp).not.toMatch(/script-src/);
    expect(Object.keys(LOGO_RESPONSE_HEADERS)).toHaveLength(2);
  });
});

describe('resolveLogoStoragePath', () => {
  it('honours LOGO_STORAGE_PATH', () => {
    expect(resolveLogoStoragePath({ LOGO_STORAGE_PATH: '/srv/bowin/logos', NODE_ENV: 'production' })).toBe('/srv/bowin/logos');
  });

  it('defaults to the node-owned image volume in production', () => {
    expect(resolveLogoStoragePath({ NODE_ENV: 'production' })).toBe('/app/data/logos');
    expect(resolveLogoStoragePath({ NODE_ENV: 'production', LOGO_STORAGE_PATH: '  ' })).toBe('/app/data/logos');
  });

  it('defaults to a local data directory in development', () => {
    expect(resolveLogoStoragePath({ NODE_ENV: 'development' })).toBe(path.resolve(process.cwd(), 'data', 'logos'));
  });

  it('never uses the old hard-coded /opt/cursor path', () => {
    expect(LOGO_STORAGE_PATH).not.toContain('/opt/cursor');
  });
});

describe('PUT /api/organizations/:orgId/branding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const put = (body: Record<string, unknown>) =>
    request(makeApp()).put('/api/organizations/org-1/branding').send(body);

  it('saves the name and an upper-cased colour', async () => {
    const res = await put({ brandName: '  Newton TKD ', brandPrimaryColor: '#1d4ed8' });
    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'org-1' },
      data: { brandName: 'Newton TKD', brandPrimaryColor: '#1D4ED8' },
    }));
  });

  it('clears both with null or blank', async () => {
    const res = await put({ brandName: '', brandPrimaryColor: null });
    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { brandName: null, brandPrimaryColor: null },
    }));
  });

  it('rejects a colour that is not a hex code', async () => {
    const res = await put({ brandName: 'X', brandPrimaryColor: 'red;background:url(x)' });
    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('refuses scorekeeper members', async () => {
    prisma.organizationMember.findUnique.mockResolvedValueOnce({ role: 'scorekeeper' });
    const res = await put({ brandName: 'X', brandPrimaryColor: '#000000' });
    expect(res.status).toBe(403);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

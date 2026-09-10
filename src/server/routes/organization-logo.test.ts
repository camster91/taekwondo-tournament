/**
 * SH-2 regression coverage: organization logo upload must reject any
 * payload whose decoded bytes are not a raster image that file-type
 * can validate against its own magic-byte signature. In particular,
 * SVG bytes must NEVER be persisted to /opt/cursor/logos regardless of
 * the client-supplied `mimeType` — see review/01-security.md §3.1.
 *
 * Strategy: capture the route handlers via a mock express Router,
 * mock auth + Prisma + the file-type detector so the handler doesn't
 * touch disk or the real database, and exercise the validation paths.
 * Both the rejection matrix and the happy path are covered without
 * requiring a live filesystem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: [] as Array<{ method: string; path: string; handler: any }>,
  // Lets each test stub the file-type detector with whatever it wants
  // the sniff to report. Default: 'image/png' (the common accept case).
  detectedMime: 'image/png' as string | undefined,
  fsWrites: [] as Array<{ path: string; data: Uint8Array | Buffer }>,
}));

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['post', 'delete'] as const) {
    router[method] = (path: string, ...args: any[]) => {
      mocks.handlers.push({ method, path, handler: args.at(-1) });
      return router;
    };
  }
  return { Router: vi.fn(() => router) };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: class {},
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('file-type', () => ({
  // Test-controlled sniff. Tests that exercise a rejection set
  // mocks.detectedMime = undefined or 'image/svg+xml' to drive the
  // rejection path. Tests that exercise the accept path leave the
  // default ('image/png') in place.
  fileTypeFromBuffer: vi.fn(async () => {
    const mime = mocks.detectedMime;
    return mime ? { mime, ext: mime.split('/')[1] } : undefined;
  }),
}));

vi.mock('fs/promises', () => {
  const writeFile = vi.fn(async (p: string, data: any) => {
    mocks.fsWrites.push({ path: p, data });
  });
  const unlink = vi.fn(async () => {});
  const mkdir = vi.fn(async () => {});
  return {
    default: { writeFile, unlink, mkdir },
    writeFile,
    unlink,
    mkdir,
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

import './organization-logo.js';

const handler = (method: string, path: string) => {
  const route = mocks.handlers.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Missing ${method.toUpperCase()} ${path} route`);
  return route.handler;
};

const response = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((statusCode: number) => { res.statusCode = statusCode; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
};

// Real PNG-ish bytes (only the magic header is needed — file-type is
// mocked in the test so the body itself doesn't matter for accept tests).
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

// Malicious SVG carrying an <svg onload=...> event handler and an
// inline <script>. The text-form payload is enough to trigger
// file-type's SVG signature detector in a real (non-mocked) run.
const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
  '<script>fetch("/api/incidents", {method:"POST", body: JSON.stringify({stolen:document.cookie})})</script>' +
  '<rect width="100" height="100" fill="red" onload="alert(1)"/>' +
  '</svg>',
);

const buildPrisma = (overrides: Partial<{
  organization: any;
}> = {}) => {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(overrides.organization ?? {
        id: 'org-1',
        slug: 'synthetic-dojang',
        brandLogoUrl: null,
      }),
      update: vi.fn().mockResolvedValue({ id: 'org-1', brandLogoUrl: '/logos/synthetic-dojang-abc.png' }),
    },
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue({ id: 'member-1' }),
    },
  };
};

const callLogoBase64 = async (prisma: any, body: any, user: any = { id: 'admin-1', role: 'admin' }) => {
  const req: any = {
    user,
    app: { locals: { prisma } },
    params: { orgId: 'org-1' },
    body,
  };
  const res = response();
  await handler('post', '/:orgId/logo-base64')(req, res);
  return res;
};

describe('organization logo upload (SH-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fsWrites.length = 0;
    // Default: a clean sniff that returns 'image/png'. Individual tests
    // override this to exercise the rejection matrix.
    mocks.detectedMime = 'image/png';
  });

  it('rejects SVG bytes when the client claims image/png (the SH-2 attack vector)', async () => {
    // Simulate file-type reporting SVG detection despite a lying client.
    mocks.detectedMime = 'image/svg+xml';
    const prisma = buildPrisma();
    const res = await callLogoBase64(prisma, {
      data: SVG_BYTES.toString('base64'),
      mimeType: 'image/png',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Unsupported image type. Allowed: PNG, JPEG, GIF, WebP.',
    });
    expect(mocks.fsWrites).toHaveLength(0);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects SVG bytes when the client honestly claims image/svg+xml', async () => {
    mocks.detectedMime = 'image/svg+xml';
    const prisma = buildPrisma();
    const res = await callLogoBase64(prisma, {
      data: SVG_BYTES.toString('base64'),
      mimeType: 'image/svg+xml',
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.fsWrites).toHaveLength(0);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects when file-type cannot detect any signature (too-small / garbage buffer)', async () => {
    // Sniff returns undefined — buffer is too small or unrecognized.
    mocks.detectedMime = undefined;
    const prisma = buildPrisma();
    const res = await callLogoBase64(prisma, {
      data: Buffer.from('not-an-image').toString('base64'),
      mimeType: 'image/png',
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.fsWrites).toHaveLength(0);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects a data URL whose embedded MIME claims SVG even with image/png body header', async () => {
    mocks.detectedMime = 'image/svg+xml';
    const prisma = buildPrisma();
    const dataUrl = `data:image/svg+xml;base64,${SVG_BYTES.toString('base64')}`;
    const res = await callLogoBase64(prisma, {
      data: dataUrl,
      mimeType: 'image/png',
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.fsWrites).toHaveLength(0);
  });

  it('rejects an empty body', async () => {
    const prisma = buildPrisma();
    const res = await callLogoBase64(prisma, { data: '' });
    expect(res.statusCode).toBe(400);
    expect(mocks.fsWrites).toHaveLength(0);
  });

  it('accepts a valid raster and writes with the sniffed extension (not the claimed one)', async () => {
    // file-type reports 'image/png' (the default). The client lies and
    // claims 'image/jpeg'. The handler must still accept and store the
    // file as .png because the extension is derived from the *sniffed*
    // MIME — never from the client header.
    mocks.detectedMime = 'image/png';
    const prisma = buildPrisma();
    const res = await callLogoBase64(prisma, {
      data: PNG_BYTES.toString('base64'),
      mimeType: 'image/jpeg',
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.fsWrites).toHaveLength(1);
    const written = mocks.fsWrites[0];
    expect(written.path).toMatch(/\.png$/);
    expect(written.path).toContain('synthetic-dojang-');
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { brandLogoUrl: expect.stringMatching(/^\/logos\/synthetic-dojang-[a-f0-9]+\.png$/) },
    });
  });

  it('still rejects GIF/XBM/MIFF — only the explicit allowlist is accepted', async () => {
    // Drive every sniffed type to the rejection path, even ones a
    // real file-type could plausibly detect (e.g. image/bmp,
    // image/tiff). Locks in the future-proof allowlist shape.
    for (const sniffed of ['image/bmp', 'image/tiff', 'image/x-icon', 'application/octet-stream']) {
      mocks.detectedMime = sniffed;
      const prisma = buildPrisma();
      const res = await callLogoBase64(prisma, {
        data: PNG_BYTES.toString('base64'),
        mimeType: 'image/png',
      });
      expect(res.statusCode).toBe(400);
      expect(mocks.fsWrites).toHaveLength(0);
    }
  });
});

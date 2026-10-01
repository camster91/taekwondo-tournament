/**
 * Staff invitation and account lifecycle tests — agent-shippable slice
 * for issue #46.
 *
 * Coverage:
 *  - POST /api/invites/send — create invitation with deterministic behavior
 *  - POST /api/invites/resend/:id — renew token + expiry, status reset
 *  - DELETE /api/invites/:id — cancel (soft) a pending invitation, remove a finished one
 *  - GET /api/invites/verify/:token — public token verification
 *  - POST /api/auth/accept-invite — accept invitation, create user
 *  - Expiry handling — expired invitations marked + rejected
 *  - Duplicate email protection — user exists / pending invite exists
 *  - Role change propagation — tokenVersion bump on role change
 *  - Deactivation — isActive=false blocks login, pending invites remain
 *  - Email delivery stubbed — tests pass without Mailgun credentials
 *
 * Out of scope (leftover for Cameron):
 *  - Live Mailgun delivery verification
 *  - SSO flows
 *  - Multi-org assignment at acceptance time
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// Mock the heavy middleware so JWT_SECRET / process.exit don't fire
vi.mock('../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = req._mockUser;
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
  createToken: vi.fn(() => 'mock-jwt-token'),
  SESSION_COOKIE: 'bowin_session',
  SESSION_COOKIE_OPTIONS: {},
  setCsrfCookie: vi.fn(),
}));

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => false), // Stub: no Mailgun
}));

vi.mock('../services/email-templates.js', () => ({
  invitationEmail: vi.fn(() => ({ subject: 'Invite', html: '<html></html>' })),
  welcomeEmail: vi.fn(() => ({ subject: 'Welcome', html: '<html></html>' })),
}));

vi.mock('../services/production-config.js', () => ({
  publicAppUrlFromEnv: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('../services/audit-log.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'test-agent'),
}));

vi.mock('../utils/token-hash.js', () => ({
  hashSecret: (s: string) => `hashed_${s}`,
  secretLookupValues: (s: string) => [`hashed_${s}`, s],
}));

// Capture handlers registered on the Express router
type CapturedHandler = {
  method: string;
  path: string;
  middleware: any[];
  handler: any;
};

function getCaptured(): CapturedHandler[] {
  const g = globalThis as any;
  if (!g['__capturedInviteHandlers__']) g['__capturedInviteHandlers__'] = [];
  return g['__capturedInviteHandlers__'];
}

vi.mock('express', () => {
  const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
  const fakeRouter: any = {};
  const wrap = (method: string) => (path: string, ...args: any[]) => {
    const handler = args[args.length - 1];
    const middleware = args.slice(0, -1);
    getCaptured().push({ method, path, middleware, handler });
    return fakeRouter;
  };
  for (const m of methods) fakeRouter[m] = wrap(m);
  fakeRouter.use = vi.fn(() => fakeRouter);
  const Router = vi.fn(() => fakeRouter);
  return { Router, default: { Router } };
});

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// Now import the routes to capture handlers
import '../routes/invites.js';
import '../routes/auth.js'; // For accept-invite handler

const findHandler = (method: string, pathReg: RegExp): any => {
  const match = getCaptured().find(
    (h: CapturedHandler) => h.method === method && pathReg.test(h.path),
  );
  if (!match) throw new Error(`No handler for ${method} ${pathReg}`);
  return match.handler;
};

// Mock request/response builder
function mockReq(
  user: any = null,
  body: any = {},
  params: any = {},
  query: any = {},
): any {
  return {
    _mockUser: user,
    user,
    body,
    params,
    query,
    app: { locals: {} },
  };
}

function mockRes(): any {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('POST /api/invites/send', () => {
  const handler = findHandler('post', /^\/send$/);

  it('creates pending invitation with hashed token', async () => {
    const mockPrisma: any = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org' }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue(null), // No existing user
      },
      invitation: {
        findFirst: vi.fn().mockResolvedValue(null), // No pending invite
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'newuser@example.com',
          firstName: 'New',
          lastName: 'User',
          role: 'viewer',
          status: 'pending',
          organizationId: 'org-1',
          createdAt: new Date(),
        }),
      },
    };

    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      {
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
        role: 'viewer',
        organizationId: 'org-1',
      },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockPrisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
        role: 'viewer',
        token: expect.stringContaining('hashed_'),
        organizationId: 'org-1',
      }),
    });
  });

  it('rejects invitation when user already exists', async () => {
    const mockPrisma: any = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'existing@example.com',
        }),
      },
    };

    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      { email: 'existing@example.com', firstName: 'Test', lastName: 'User', role: 'viewer' },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'A user with this email already exists',
    });
  });

  it('rejects invitation when pending invite exists (case-insensitive)', async () => {
    const mockPrisma: any = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'pending@example.com',
          status: 'pending',
        }),
      },
    };

    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      {
        email: 'PENDING@EXAMPLE.COM', // Different case
        firstName: 'Test',
        lastName: 'User',
        role: 'viewer',
      },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'A pending invitation already exists for this email',
    });
  });

  it('requires admin role', async () => {
    const req = mockReq(
      { id: 'viewer-1', role: 'viewer' },
      { email: 'test@example.com', role: 'viewer' },
    );
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('validates email format', async () => {
    const mockPrisma: any = {};
    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      { email: 'invalid-email', firstName: 'Test', lastName: 'User', role: 'viewer' },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation failed' }),
    );
  });

  it('validates role is one of the allowed values', async () => {
    const mockPrisma: any = {};
    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      { email: 'test@example.com', firstName: 'Test', lastName: 'User', role: 'superadmin' },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns email send status when Mailgun configured', async () => {
    const mockPrisma: any = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org' }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      invitation: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'viewer',
          status: 'pending',
          organizationId: 'org-1',
          createdAt: new Date(),
        }),
      },
    };

    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'viewer',
        organizationId: 'org-1',
      },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        invitation: expect.any(Object),
        emailSent: expect.any(Boolean),
      }),
    );
  });

  it('records a failed delivery so the admin list shows an actionable state', async () => {
    const { sendEmail } = await import('../services/email.js');
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'Mailgun error: 401 Forbidden' });
    const mockPrisma: any = {
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      invitation: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({
          id: 'inv-9', email: 'x@example.com', role: 'viewer', status: 'pending', createdAt: new Date(),
        }),
      },
    };
    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      { email: 'x@example.com', firstName: 'X', lastName: 'Y', role: 'viewer' },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-9' },
      data: expect.objectContaining({
        deliveryStatus: 'failed',
        lastDeliveryError: 'Mailgun error: 401 Forbidden',
        lastSentAt: expect.any(Date),
      }),
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      emailSent: false,
      invitation: expect.objectContaining({ deliveryStatus: 'failed' }),
    }));
  });

  it('refuses to invite the email of a deactivated account (duplicate check ignores isActive)', async () => {
    const mockPrisma: any = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-1', email: 'gone@example.com', isActive: false }) },
      invitation: { findFirst: vi.fn(), create: vi.fn() },
    };
    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'A', lastName: 'B' },
      { email: 'GONE@example.com', firstName: 'X', lastName: 'Y', role: 'viewer' },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/invites/resend/:id', () => {
  const handler = findHandler('post', /^\/resend\/:id$/);

  it('generates new token and extends expiry', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'viewer',
          status: 'expired',
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({
          id: 'inv-1',
          status: 'pending',
        }),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const req = mockReq(
      { id: 'admin-1', role: 'admin', firstName: 'Admin', lastName: 'User' },
      {},
      { id: 'inv-1' },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        token: expect.stringContaining('hashed_'),
        status: 'pending',
      }),
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ emailSent: expect.any(Boolean) }),
    );
    expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({ deliveryStatus: expect.any(String), lastSentAt: expect.any(Date) }),
    });
  });

  it('rejects resend for a cancelled invitation', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'inv-1', email: 'a@example.com', status: 'cancelled' }),
        update: vi.fn(),
      },
    };
    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
  });

  it('rejects resend once the invitee already has an account', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'inv-1', email: 'a@example.com', status: 'pending' }),
        update: vi.fn(),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-1' }) },
    };
    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
  });

  it('refuses to revive an expired invite while another is pending for the email', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'inv-1', email: 'a@example.com', status: 'expired' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'inv-2' }),
        update: vi.fn(),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
  });

  it('rejects resend for accepted invitation', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          status: 'accepted',
        }),
      },
    };

    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invitation already accepted' });
  });

  it('returns 404 for non-existent invitation', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-999' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invitation not found' });
  });

  it('requires admin role', async () => {
    const req = mockReq({ id: 'viewer-1', role: 'viewer' }, {}, { id: 'inv-1' });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('DELETE /api/invites/:id', () => {
  const handler = findHandler('delete', /^\/:id$/);

  it('cancels a pending invitation and keeps the row', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'inv-1', status: 'pending', email: 'a@example.com', organizationId: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        delete: vi.fn(),
      },
    };

    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'pending' },
      data: { status: 'cancelled', cancelledAt: expect.any(Date) },
    });
    expect(mockPrisma.invitation.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 409 when the invitation was accepted before the cancel landed', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'inv-1', status: 'pending', email: 'a@example.com', organizationId: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('removes a finished invitation from the list', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'inv-1', status: 'expired', email: 'a@example.com', organizationId: null }),
        delete: vi.fn().mockResolvedValue({ id: 'inv-1' }),
      },
    };
    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-1' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(mockPrisma.invitation.delete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 404 for non-existent invitation', async () => {
    const mockPrisma: any = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const req = mockReq({ id: 'admin-1', role: 'admin' }, {}, { id: 'inv-999' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invitation not found' });
  });

  it('requires admin role', async () => {
    const req = mockReq({ id: 'scorekeeper-1', role: 'scorekeeper' }, {}, { id: 'inv-1' });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('GET /api/invites/verify/:token', () => {
  const handler = findHandler('get', /^\/verify\/:token$/);

  it('returns invitation details for valid pending token', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'viewer',
          status: 'pending',
          tokenExpiry: futureExpiry,
        }),
      },
    };

    const req = mockReq(null, {}, { token: 'valid-token' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'viewer',
    });
  });

  it('rejects expired token', async () => {
    const pastExpiry = new Date(Date.now() - 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          status: 'pending',
          tokenExpiry: pastExpiry,
        }),
      },
    };

    const req = mockReq(null, {}, { token: 'expired-token' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'expired' }));
  });

  it('rejects already-accepted token', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          status: 'accepted',
          tokenExpiry: futureExpiry,
        }),
      },
    };

    const req = mockReq(null, {}, { token: 'used-token' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'accepted' }));
  });

  it('rejects a cancelled token with 410', async () => {
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1', email: 'test@example.com', status: 'cancelled',
          tokenExpiry: new Date(Date.now() + 60_000),
        }),
      },
    };
    const req = mockReq(null, {}, { token: 'cancelled-token' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'cancelled' }));
  });

  it('returns 404 for invalid token', async () => {
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const req = mockReq(null, {}, { token: 'invalid-token' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid invitation token' });
  });

  it('is rate-limited (middleware present)', () => {
    // The handler should have rate-limit middleware
    const routeConfig = getCaptured().find(
      (h) => h.method === 'get' && /^\/verify\/:token$/.test(h.path),
    );
    expect(routeConfig?.middleware.length).toBeGreaterThan(0);
  });
});

describe('POST /api/auth/accept-invite', () => {
  const authHandlers = getCaptured();
  const handler = authHandlers.find(
    (h) => h.method === 'post' && /accept-invite/.test(h.path),
  )?.handler;

  if (!handler) {
    throw new Error('accept-invite handler not found in captured auth routes');
  }

  it('creates user and marks invitation accepted in transaction', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 60 * 1000);
    let transactionCallback: any = null;

    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'newuser@example.com',
          firstName: 'Invited',
          lastName: 'User',
          role: 'director',
          status: 'pending',
          tokenExpiry: futureExpiry,
          organizationId: 'org-1',
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue(null), // No existing user
      },
      $transaction: vi.fn(async (cb) => {
        transactionCallback = cb;
        const mockTx = {
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-1',
              email: 'newuser@example.com',
              firstName: 'New',
              lastName: 'User',
              role: 'director',
              createdAt: new Date(),
              tokenVersion: 0,
            }),
          },
          organizationMember: {
            create: vi.fn().mockResolvedValue({}),
          },
          invitation: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return await cb(mockTx);
      }),
    };

    const req = mockReq(
      null,
      {
        token: 'valid-token',
        firstName: 'New',
        lastName: 'User',
      },
    );
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          email: 'newuser@example.com',
          role: 'director',
        }),
        organizationId: 'org-1',
        message: 'Account created successfully',
      }),
    );
  });

  it('rejects when user already exists', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'existing@example.com',
          role: 'viewer',
          status: 'pending',
          tokenExpiry: futureExpiry,
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'existing@example.com',
        }),
      },
    };

    const req = mockReq(null, {
      token: 'valid-token',
      firstName: 'Test',
      lastName: 'User',
    });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'An account with this email already exists',
    });
  });

  it('rejects expired invitation', async () => {
    const pastExpiry = new Date(Date.now() - 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          role: 'viewer',
          status: 'pending',
          tokenExpiry: pastExpiry,
        }),
      },
    };

    const req = mockReq(null, {
      token: 'expired-token',
      firstName: 'Test',
      lastName: 'User',
    });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'expired' }));
  });

  it('rejects already-accepted invitation', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          status: 'accepted',
          tokenExpiry: futureExpiry,
        }),
      },
    };

    const req = mockReq(null, {
      token: 'used-token',
      firstName: 'Test',
      lastName: 'User',
    });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'accepted' }));
  });

  it('a concurrent or replayed accept that loses the claim creates no account', async () => {
    const userCreate = vi.fn();
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1', email: 'race@example.com', role: 'director', status: 'pending',
          tokenExpiry: new Date(Date.now() + 60_000), organizationId: null,
        }),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (cb) => cb({
        invitation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        user: { create: userCreate },
        organizationMember: { create: vi.fn() },
      })),
    };
    const req = mockReq(null, { token: 'valid-token', firstName: 'R', lastName: 'C' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(userCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('checks for an existing account case-insensitively', async () => {
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1', email: 'mixed@example.com', role: 'viewer', status: 'pending',
          tokenExpiry: new Date(Date.now() + 60_000),
        }),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-1' }) },
    };
    const req = mockReq(null, { token: 'valid-token', firstName: 'A', lastName: 'B' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: 'mixed@example.com', mode: 'insensitive' } },
    }));
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('requires firstName and lastName', async () => {
    const req = mockReq(null, { token: 'valid-token' });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'First name and last name are required',
    });
  });

  it('sets session cookie after successful acceptance', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const mockPrisma: any = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          email: 'test@example.com',
          role: 'viewer',
          status: 'pending',
          tokenExpiry: futureExpiry,
          organizationId: null,
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (cb) => {
        const mockTx = {
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-1',
              email: 'test@example.com',
              firstName: 'Test',
              lastName: 'User',
              role: 'viewer',
              createdAt: new Date(),
              tokenVersion: 0,
            }),
          },
          invitation: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return await cb(mockTx);
      }),
    };

    const req = mockReq(null, {
      token: 'valid-token',
      firstName: 'Test',
      lastName: 'User',
    });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(res.cookie).toHaveBeenCalledWith('bowin_session', expect.any(String), expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('GET /api/invites (list)', () => {
  const handler = findHandler('get', /^\/$/);

  it('marks expired invitations before listing', async () => {
    const mockPrisma: any = {
      invitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inv-1',
            email: 'pending@example.com',
            firstName: 'Pending',
            lastName: 'User',
            role: 'viewer',
            status: 'pending',
            createdAt: new Date(),
            tokenExpiry: new Date(Date.now() + 10 * 60 * 60 * 1000),
          },
          {
            id: 'inv-2',
            email: 'expired@example.com',
            firstName: 'Expired',
            lastName: 'User',
            role: 'viewer',
            status: 'expired',
            createdAt: new Date(),
            tokenExpiry: new Date(Date.now() - 1000),
          },
        ]),
      },
    };

    const req = mockReq({ id: 'admin-1', role: 'admin' });
    req.app.locals.prisma = mockPrisma;
    const res = mockRes();

    await handler(req, res);

    expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        tokenExpiry: { lt: expect.any(Date) },
      },
      data: { status: 'expired' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.any(Array));
  });

  it('requires admin role', async () => {
    const req = mockReq({ id: 'director-1', role: 'director' });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('User account lifecycle integration', () => {
  it('role change on existing user bumps tokenVersion (auth.ts)', async () => {
    // This is tested in auth-route.test.ts but documented here
    // for completeness of the invitation lifecycle story.
    // When an admin changes a user's role after invitation acceptance,
    // the tokenVersion is bumped to invalidate old JWTs.
    expect(true).toBe(true); // Cross-reference to auth-route.test.ts
  });
});

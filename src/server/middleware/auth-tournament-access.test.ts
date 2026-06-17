// Regression tests for requireTournamentAccess middleware.
//
// We mock the Prisma client so the tests don't need a database. The
// middleware is the multi-tenant enforcement boundary; these tests
// pin the 5-step authorization precedence:
//
// 1. Admin - always allowed
// 2. Explicit UserTournamentAccess row - check role hierarchy
// 3. Orphan tournament (no org) - fall back to global role
// 4. Org-scoped tournament + user is org member - allow
// 5. Otherwise - 403
//
// Each test calls the middleware directly with a fake req/res and
// a mocked prisma client.

import { describe, it, expect, vi } from 'vitest';
import { requireTournamentAccess } from './auth.js';

const mockReq = (overrides: any = {}): any => ({
  user: undefined,
  app: { locals: { prisma: null } },
  params: {},
  ...overrides,
});

const mockRes = (): any => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
};

const buildPrismaMock = (overrides: any = {}) => {
  return {
    userTournamentAccess: {
      findUnique: vi.fn().mockResolvedValue(overrides.access ?? null),
    },
    tournament: {
      findUnique: vi.fn().mockResolvedValue(overrides.tournament ?? { organizationId: null }),
    },
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue(overrides.membership ?? null),
    },
  };
};

describe('requireTournamentAccess - admin', () => {
  it('admin is allowed regardless of tournament/org state', async () => {
    const req = mockReq({
      user: { id: 'admin-1', email: 'a@x.com', role: 'admin' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock() } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});

describe('requireTournamentAccess - explicit UserTournamentAccess', () => {
  it('director-level explicit access passes the director minRole', async () => {
    // The global role check requires the user to have the role at
    // least at the minRole level globally. So a user with global
    // role 'director' (or 'admin') passes both checks.
    const req = mockReq({
      user: { id: 'u-1', role: 'director' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock({ access: { role: 'director' } }) } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('viewer-level access is rejected for director minRole', async () => {
    // Global role 'viewer' fails the role hierarchy check before
    // the explicit access check is consulted. The error message
    // reflects the global-role fail.
    const req = mockReq({
      user: { id: 'u-1', role: 'viewer' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock({ access: { role: 'viewer' } }) } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Insufficient role/);
  });

  it('explicit access with unknown role string falls back to role level 0 (rejected for any minRole)', async () => {
    // Use global role 'director' so the global-role check passes.
    // The explicit-row role check then sees role='godmode' which
    // maps to level 0, less than the required 3 (director), so
    // the explicit-row check rejects.
    const req = mockReq({
      user: { id: 'u-1', role: 'director' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock({ access: { role: 'godmode' } }) } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Insufficient tournament permissions/);
  });
});

describe('requireTournamentAccess - orphan tournament (single-tenant fallback)', () => {
  it('global director can mutate orphan tournament without explicit access', async () => {
    // No explicit access row, no organizationId. Pre-multi-tenant
    // behavior: any user with the required global role is allowed.
    const req = mockReq({
      user: { id: 'u-1', role: 'director' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock({ tournament: { organizationId: null } }) } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('viewer is rejected on orphan tournament when minRole is scorekeeper', async () => {
    // The minRole check kicks in before the org lookup. Viewer
    // cannot mutate scorekeeper-tier resources regardless of org
    // state.
    const req = mockReq({
      user: { id: 'u-1', role: 'viewer' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock({ tournament: { organizationId: null } }) } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('scorekeeper')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Insufficient role/);
  });
});

describe('requireTournamentAccess - org-scoped multi-tenant boundary', () => {
  it('org member is allowed on a tournament in their org', async () => {
    const req = mockReq({
      user: { id: 'u-1', role: 'director' },
      params: { id: 't-1' },
      app: {
        locals: {
          prisma: buildPrismaMock({
            tournament: { organizationId: 'org-1' },
            membership: { id: 'm-1', userId: 'u-1', organizationId: 'org-1' },
          }),
        },
      },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('non-org-member is rejected on a tournament in another org (THE SECURITY BOUNDARY)', async () => {
    const req = mockReq({
      user: { id: 'u-1', role: 'director' }, // Global director role, but not in this org
      params: { id: 't-1' },
      app: {
        locals: {
          prisma: buildPrismaMock({
            tournament: { organizationId: 'org-1' },
            membership: null, // not a member of org-1
          }),
        },
      },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/No access to this tournament/);
  });

  it('explicit UserTournamentAccess row overrides org-membership check (when present, the row wins)', async () => {
    // The user is NOT a member of the org, but has an explicit
    // access row granting them director for THIS tournament.
    // The explicit row wins (operator may have granted cross-org
    // access to a contractor, for example).
    const req = mockReq({
      user: { id: 'u-1', role: 'admin' }, // admin bypasses the global check
      params: { id: 't-1' },
      app: {
        locals: {
          prisma: buildPrismaMock({
            access: { role: 'director' },
            tournament: { organizationId: 'org-1' },
            membership: null, // not in the org
          }),
        },
      },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('requireTournamentAccess - parameter handling', () => {
  it('accepts tournamentId from req.params.tournamentId', async () => {
    const req = mockReq({
      user: { id: 'admin', role: 'admin' },
      params: { tournamentId: 't-1' },
      app: { locals: { prisma: buildPrismaMock() } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('viewer')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 400 when no tournament id in params', async () => {
    const req = mockReq({
      user: { id: 'u-1', role: 'director' },
      params: {},
      app: { locals: { prisma: buildPrismaMock() } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when no user is on the request', async () => {
    const req = mockReq({
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock() } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('viewer')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

// Regression tests for requireTournamentAccess middleware.
//
// We mock the Prisma client so the tests don't need a database. The
// middleware is the multi-tenant enforcement boundary; these tests
// pin the authorization precedence:
//
// 1. Admin - always allowed
// 2. Global role must meet minRole
// 3. Missing / soft-deleted tournament - 404 (unless allowDeleted)
// 4. Explicit UserTournamentAccess row - check role hierarchy
// 5. Org-scoped tournament + org member - min(global, membership role)
// 6. Orphan tournament (no org) - only for users with NO org
//    memberships (legacy single-tenant pool)
// 7. Otherwise - 403
//
// Each test calls the middleware directly with a fake req/res and
// a mocked prisma client.

import { describe, it, expect, vi } from 'vitest';
import {
  requireTournamentAccess,
  checkTournamentAccess,
  buildTournamentAccessFilter,
  buildCompetitorAccessFilter,
  buildCompetitorWriteFilter,
  orgMembershipRoleLevel,
} from './auth.js';

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
      findUnique: vi.fn().mockResolvedValue(
        overrides.tournament === undefined ? { organizationId: null, deletedAt: null } : overrides.tournament,
      ),
    },
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue(overrides.membership ?? null),
      count: vi.fn().mockResolvedValue(overrides.membershipCount ?? 0),
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
            membership: { id: 'm-1', userId: 'u-1', organizationId: 'org-1', role: 'director' },
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

describe('checkTournamentAccess - orphan tournaments are the legacy pool only', () => {
  it('director WITH org memberships is rejected on an orphan tournament', async () => {
    const prisma = buildPrismaMock({ tournament: { organizationId: null, deletedAt: null }, membershipCount: 1 });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-orphan', 'viewer');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('director with NO org memberships is allowed on an orphan tournament', async () => {
    const prisma = buildPrismaMock({ tournament: { organizationId: null, deletedAt: null }, membershipCount: 0 });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-orphan', 'director');

    expect(result.ok).toBe(true);
  });

  it('director with NO org memberships is rejected on an org-owned tournament', async () => {
    const prisma = buildPrismaMock({ tournament: { organizationId: 'org-1', deletedAt: null }, membership: null });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-1', 'viewer');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('explicit grant still opens an orphan tournament for a tenant user', async () => {
    const prisma = buildPrismaMock({
      access: { role: 'scorekeeper' },
      tournament: { organizationId: null, deletedAt: null },
      membershipCount: 2,
    });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-orphan', 'scorekeeper');

    expect(result.ok).toBe(true);
  });
});

describe('checkTournamentAccess - org membership role is respected', () => {
  const orgTournament = { organizationId: 'org-1', deletedAt: null };

  it('viewer membership cannot mutate (director minRole) even with a global director role', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'viewer' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-1', 'director');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/Insufficient organization permissions/);
  });

  it('viewer membership can still read', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'viewer' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-1', 'viewer');

    expect(result.ok).toBe(true);
  });

  it('owner membership counts as director', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'owner' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'director')).ok).toBe(true);
  });

  it('org-admin membership counts as director', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'admin' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'director')).ok).toBe(true);
  });

  it('effective role is min(global, membership): owner membership does not lift a global scorekeeper to director', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'owner' } });
    const req = mockReq({ user: { id: 'u-1', role: 'scorekeeper' } });

    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'scorekeeper')).ok).toBe(true);
    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'director')).ok).toBe(false);
  });

  it('scorekeeper membership passes scorekeeper minRole but not director', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'scorekeeper' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'scorekeeper')).ok).toBe(true);
    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'director')).ok).toBe(false);
  });

  it('unknown membership role grants nothing', async () => {
    const prisma = buildPrismaMock({ tournament: orgTournament, membership: { role: 'godmode' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    expect((await checkTournamentAccess(req, prisma as any, 't-1', 'viewer')).ok).toBe(false);
  });

  it('maps membership roles onto the hierarchy', () => {
    expect(orgMembershipRoleLevel('owner')).toBe(3);
    expect(orgMembershipRoleLevel('admin')).toBe(3);
    expect(orgMembershipRoleLevel('director')).toBe(3);
    expect(orgMembershipRoleLevel('scorekeeper')).toBe(2);
    expect(orgMembershipRoleLevel('viewer')).toBe(1);
    // 'member' is the schema default and defers to the global role.
    expect(orgMembershipRoleLevel('member')).toBe(3);
    expect(orgMembershipRoleLevel(undefined)).toBe(0);
  });
});

describe('checkTournamentAccess - soft-deleted tournaments', () => {
  const deleted = { organizationId: 'org-1', deletedAt: new Date('2026-01-01') };

  it('explicit grant does NOT reach a soft-deleted tournament', async () => {
    const prisma = buildPrismaMock({ access: { role: 'director' }, tournament: deleted });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-1', 'viewer');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('org director can reach their own soft-deleted tournament with allowDeleted (restore / trash)', async () => {
    const prisma = buildPrismaMock({ tournament: deleted, membership: { role: 'director' } });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-1', 'director', { allowDeleted: true });

    expect(result.ok).toBe(true);
  });

  it('allowDeleted does not bypass the tenant boundary', async () => {
    const prisma = buildPrismaMock({ tournament: deleted, membership: null });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-1', 'director', { allowDeleted: true });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('missing tournament is 404 even with an explicit grant row', async () => {
    const prisma = buildPrismaMock({ access: { role: 'director' }, tournament: null });
    const req = mockReq({ user: { id: 'u-1', role: 'director' } });

    const result = await checkTournamentAccess(req, prisma as any, 't-missing', 'viewer');

    expect(result.status).toBe(404);
  });

  it('requireTournamentAccess forwards allowDeleted', async () => {
    const req = mockReq({
      user: { id: 'u-1', role: 'director' },
      params: { id: 't-1' },
      app: { locals: { prisma: buildPrismaMock({ tournament: deleted, membership: { role: 'owner' } }) } },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireTournamentAccess('director', { allowDeleted: true })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('buildTournamentAccessFilter - no fail-open fallback', () => {
  const scopePrisma = (memberships: any[], grants: any[]) => ({
    organizationMember: { findMany: vi.fn().mockResolvedValue(memberships) },
    userTournamentAccess: { findMany: vi.fn().mockResolvedValue(grants) },
  });

  it('admin is unscoped (null)', async () => {
    const req = mockReq({ user: { id: 'a', role: 'admin' } });
    expect(await buildTournamentAccessFilter(req, scopePrisma([], []) as any)).toBeNull();
  });

  it('user with no orgs and no grants is scoped to orphan tournaments (NOT null)', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    const filter = await buildTournamentAccessFilter(req, scopePrisma([], []) as any);
    expect(filter).toEqual({ OR: [{ id: { in: [] } }, { organizationId: null }] });
  });

  it('user with no orgs sees orphan tournaments + explicit grants', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    const filter = await buildTournamentAccessFilter(
      req,
      scopePrisma([], [{ tournamentId: 't-granted', role: 'viewer' }]) as any,
    );
    expect(filter).toEqual({ OR: [{ id: { in: ['t-granted'] } }, { organizationId: null }] });
  });

  it('org user sees own orgs + grants and never orphan tournaments', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    const filter = await buildTournamentAccessFilter(
      req,
      scopePrisma(
        [{ organizationId: 'org-1', role: 'owner' }, { organizationId: 'org-x', role: 'bogus' }],
        [{ tournamentId: 't-granted', role: 'director' }, { tournamentId: 't-bad', role: 'godmode' }],
      ) as any,
    );
    expect(filter).toEqual({ OR: [{ id: { in: ['t-granted'] } }, { organizationId: { in: ['org-1'] } }] });
    expect(JSON.stringify(filter)).not.toContain('"organizationId":null');
  });

  it('unauthenticated request matches nothing', async () => {
    const req = mockReq({ user: undefined });
    expect(await buildTournamentAccessFilter(req, scopePrisma([], []) as any)).toEqual({ id: { in: [] } });
  });
});

describe('buildCompetitorAccessFilter / buildCompetitorWriteFilter', () => {
  const scopePrisma = (memberships: any[]) => ({
    organizationMember: { findMany: vi.fn().mockResolvedValue(memberships) },
    userTournamentAccess: { findMany: vi.fn().mockResolvedValue([]) },
  });
  const orgTournamentFilter = { OR: [{ id: { in: [] } }, { organizationId: { in: ['org-1'] } }] };
  const legacyTournamentFilter = { OR: [{ id: { in: [] } }, { organizationId: null }] };

  it('admin is unscoped for read and write', async () => {
    const req = mockReq({ user: { id: 'a', role: 'admin' } });
    expect(await buildCompetitorAccessFilter(req, scopePrisma([]) as any)).toBeNull();
    expect(await buildCompetitorWriteFilter(req, scopePrisma([]) as any)).toBeNull();
  });

  it('org user reads competitors registered in accessible tournaments, or unregistered ones their org owns', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    expect(await buildCompetitorAccessFilter(req, scopePrisma([{ organizationId: 'org-1', role: 'director' }]) as any)).toEqual({
      OR: [
        { registrations: { some: { tournament: orgTournamentFilter } } },
        { registrations: { none: {} }, organizationId: { in: ['org-1'] } },
      ],
    });
  });

  it('legacy user also reads unregistered competitors with no owning org', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    expect(await buildCompetitorAccessFilter(req, scopePrisma([]) as any)).toEqual({
      OR: [
        { registrations: { some: { tournament: legacyTournamentFilter } } },
        { registrations: { none: {} }, organizationId: null },
      ],
    });
  });

  it('org user may write only when EVERY registration is accessible (or it is an unregistered competitor their org owns)', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    expect(await buildCompetitorWriteFilter(req, scopePrisma([{ organizationId: 'org-1', role: 'director' }]) as any)).toEqual({
      AND: [
        { registrations: { every: { tournament: orgTournamentFilter } } },
        {
          OR: [
            { registrations: { some: { tournament: orgTournamentFilter } } },
            { registrations: { none: {} }, organizationId: { in: ['org-1'] } },
          ],
        },
      ],
    });
  });

  it('legacy user may write when every registration is in the legacy pool (incl. unowned unregistered)', async () => {
    const req = mockReq({ user: { id: 'u', role: 'director' } });
    expect(await buildCompetitorWriteFilter(req, scopePrisma([]) as any)).toEqual({
      AND: [
        { registrations: { every: { tournament: legacyTournamentFilter } } },
        {
          OR: [
            { registrations: { some: { tournament: legacyTournamentFilter } } },
            { registrations: { none: {} }, organizationId: null },
          ],
        },
      ],
    });
  });
});

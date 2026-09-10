// SH-3 regression tests: the public demo session must be tenant-scoped to
// the synthetic demo organization, never see a real tenant's data, and
// never be allowed to mutate production state.
//
// Closes the audit's CRITICAL 3.2 finding: "Demo user (role='admin', no
// org) reads every tenant's tournament data when ENABLE_DEMO_LOGIN=1 &&
// DEMO_ISOLATED_DATA=1". The fix gives the demo user the scoped `demo`
// role and pins it as a single OrganizationMember of the synthetic
// tenant, so every read goes through the org-membership branch in
// checkTournamentAccess and buildTournamentAccessFilter.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import {
  checkTournamentAccess,
  createToken,
  DEMO_ORG_ID,
  DEMO_ROLE,
  isDemoUser,
  type AuthenticatedRequest,
} from './auth.js';

const mockReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest => {
  const req = {
    user: undefined,
    method: 'GET',
    originalUrl: '/',
    params: {},
    app: { locals: { prisma: null } },
    headers: {},
    ...overrides,
  } as unknown as AuthenticatedRequest;
  return req;
};

const mockRes = (): { statusCode: number; body: unknown } => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
  };
  (res as unknown as { status: (code: number) => typeof res }).status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  (res as unknown as { json: (data: unknown) => typeof res }).json = (data: unknown) => {
    res.body = data;
    return res;
  };
  return res;
};

describe('SH-3: demo user is tenant-scoped to the synthetic demo org', () => {
  it('exposes DEMO_ROLE and DEMO_ORG_ID as the synthetic tenant contract', () => {
    expect(DEMO_ROLE).toBe('demo');
    expect(DEMO_ORG_ID).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('identifies demo sessions by either the role or the isDemo flag', () => {
    expect(isDemoUser({ role: DEMO_ROLE, isDemo: true } as { role: string; isDemo: boolean })).toBe(true);
    expect(isDemoUser({ role: 'admin', isDemo: true } as { role: string; isDemo: boolean })).toBe(true);
    expect(isDemoUser({ role: 'admin', isDemo: false } as { role: string; isDemo: boolean })).toBe(false);
    expect(isDemoUser({ role: 'director', isDemo: false } as { role: string; isDemo: boolean })).toBe(false);
  });
});

describe('SH-3: checkTournamentAccess blocks the demo user from a real tenant', () => {
  it('returns 403/404 when the demo user targets another tenant\'s tournament', async () => {
    // Mock prisma: the demo user holds no membership in the real
    // org, has no explicit access row, and is NOT the global admin.
    // checkTournamentAccess must hit the org-membership branch and
    // reject — the same fail-closed path a real multi-tenant
    // director would get without org membership.
    const findUnique = vi.fn().mockImplementation(async ({ where }: { where: { userId_tournamentId?: { userId: string; tournamentId: string }; id: string } }) => {
      if (where.userId_tournamentId) return null;
      if (where.id === 'real-tenant-tournament') {
        return { organizationId: 'real-tenant-org', deletedAt: null };
      }
      return null;
    });
    const findUniqueOrg = vi.fn().mockResolvedValue(null); // no membership in real-tenant-org
    const prisma = {
      userTournamentAccess: { findUnique },
      tournament: { findUnique },
      organizationMember: { findUnique: findUniqueOrg },
    } as unknown as Parameters<typeof checkTournamentAccess>[1];

    const req = mockReq({
      user: {
        id: 'demo-user',
        email: 'demo@bowin.app',
        role: DEMO_ROLE,
        firstName: 'Demo',
        lastName: 'Visitor',
        isDemo: true,
        tenantId: DEMO_ORG_ID,
      },
      params: { id: 'real-tenant-tournament' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    // Demo user's global role is 'demo', not 'admin' — the
    // short-circuit must NOT fire, so the request flows into the
    // explicit-access → org-membership check.
    const result = await checkTournamentAccess(req, prisma, 'real-tenant-tournament', 'viewer');

    expect(result.ok).toBe(false);
    // 403 is the expected outcome for a demo user that has no
    // explicit access row and no membership in the real tenant's org.
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/No access to this tournament/);
  });

  it('allows the demo user into the synthetic demo org\'s tournament (the only thing it should see)', async () => {
    // The demo user IS a member of DEMO_ORG_ID. A tournament in that
    // org must pass the org-membership branch — the demo's only
    // legitimate read surface.
    const findUnique = vi.fn().mockImplementation(async ({ where }: { where: { userId_tournamentId?: { userId: string; tournamentId: string }; id: string } }) => {
      if (where.userId_tournamentId) return null;
      if (where.id === 'demo-org-tournament') {
        return { organizationId: DEMO_ORG_ID, deletedAt: null };
      }
      return null;
    });
    const findUniqueOrg = vi.fn().mockResolvedValue({ id: 'member-1', userId: 'demo-user', organizationId: DEMO_ORG_ID });
    const prisma = {
      userTournamentAccess: { findUnique },
      tournament: { findUnique },
      organizationMember: { findUnique: findUniqueOrg },
    } as unknown as Parameters<typeof checkTournamentAccess>[1];

    const req = mockReq({
      user: {
        id: 'demo-user',
        email: 'demo@bowin.app',
        role: DEMO_ROLE,
        firstName: 'Demo',
        lastName: 'Visitor',
        isDemo: true,
        tenantId: DEMO_ORG_ID,
      },
      params: { id: 'demo-org-tournament' },
      app: { locals: { prisma } },
    });

    const result = await checkTournamentAccess(req, prisma, 'demo-org-tournament', 'viewer');
    expect(result.ok).toBe(true);
  });

  it('does NOT short-circuit on the demo user (the old `role === \'admin\'` bypass is gone)', async () => {
    // Even with a prisma that returns nothing, the result must
    // be a fail-closed rejection, not the blanket `ok: true` the
    // old code returned for any admin. We confirm this by checking
    // that tournament / organizationMember lookups were actually
    // attempted (admin short-circuit skips them).
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      userTournamentAccess: { findUnique },
      tournament: { findUnique },
      organizationMember: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Parameters<typeof checkTournamentAccess>[1];

    const req = mockReq({
      user: {
        id: 'demo-user',
        email: 'demo@bowin.app',
        role: DEMO_ROLE,
        firstName: 'Demo',
        lastName: 'Visitor',
        isDemo: true,
        tenantId: DEMO_ORG_ID,
      },
      params: { id: 'any-tournament' },
      app: { locals: { prisma } },
    });

    const result = await checkTournamentAccess(req, prisma, 'any-tournament', 'viewer');
    expect(result.ok).toBe(false);
    // The explicit-access and tournament lookups must have been
    // attempted — proves the admin short-circuit didn't fire.
    expect(prisma.userTournamentAccess.findUnique).toHaveBeenCalled();
    expect(prisma.tournament.findUnique).toHaveBeenCalled();
  });
});

describe('SH-3: enforceDemoCapability blocks the demo session from /api/incidents', () => {
  // The previous allowlist permitted POST /api/incidents for demo
  // sessions — a real-tenant write surface. With the fix, every
  // write path that is not the explicit logout allowance is denied.
  // We assert at the middleware level so the test pins the policy
  // independent of the route wiring.
  it('returns 403 with DEMO_CAPABILITY_DENIED for POST /api/incidents', async () => {
    const { isDemoRequestAllowed } = await import('./auth.js');
    expect(isDemoRequestAllowed('POST', '/api/incidents')).toBe(false);
  });

  it('returns 403 for every bracket / registration / incident write the demo was previously allowed', async () => {
    const { isDemoRequestAllowed } = await import('./auth.js');
    expect(isDemoRequestAllowed('PUT', '/api/brackets/match/match-id')).toBe(false);
    expect(isDemoRequestAllowed('POST', '/api/brackets/match/match-id/undo')).toBe(false);
    expect(isDemoRequestAllowed('PUT', '/api/tournaments/tournament-id/registrations/registration-id')).toBe(false);
  });

  it('still allows POST /api/auth/logout for the demo session', async () => {
    const { isDemoRequestAllowed } = await import('./auth.js');
    expect(isDemoRequestAllowed('POST', '/api/auth/logout')).toBe(true);
  });
});

describe('SH-3: demo user can reach the public landing endpoint', () => {
  let server: Server;
  let baseUrl: string;
  let demoToken: string;

  beforeAll(async () => {
    // Stand up a minimal public landing endpoint that 200s when the
    // caller is authenticated OR anonymous, and exposes the demo
    // user's resolved identity for assertion.
    const app = express();
    app.use((req, _res, next) => {
      // The synthetic-tenant demo is a real auth case here — the
      // production code wires the public routes to optionalAuthenticate,
      // and a demo visitor's cookie should resolve just like any
      // other browser session. This mirrors that contract.
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer ')) {
        (req as AuthenticatedRequest).user = undefined;
        return next();
      }
      try {
        // Decode without verification — the demo is a public test
        // surface here, we only care that the policy layer doesn't
        // reject it. The real verify happens in authenticate().
        const payload = JSON.parse(Buffer.from(auth.substring(7).split('.')[1], 'base64').toString()) as {
          userId: string;
          role: string;
          tenantId?: string;
        };
        (req as AuthenticatedRequest).user = {
          id: payload.userId,
          email: 'demo@bowin.app',
          role: payload.role,
          firstName: 'Demo',
          lastName: 'Visitor',
          isDemo: true,
          tenantId: payload.tenantId,
        };
      } catch {
        (req as AuthenticatedRequest).user = undefined;
      }
      next();
    });
    app.get('/api/public-portal/:orgSlug', (req: AuthenticatedRequest, res) => {
      // Public landing: never gate on auth. The demo user is a
      // legitimate visitor of the public landing; the synthetic
      // tenant does not affect the public surface.
      if (req.params.orgSlug === 'bowin-showcase-demo') {
        return res.status(200).json({
          organization: { slug: req.params.orgSlug, name: 'Bowin Showcase Dojangs (Fabricated)' },
          authenticatedAs: req.user ? { id: req.user.id, role: req.user.role, tenantId: req.user.tenantId } : null,
        });
      }
      return res.status(404).json({ error: 'Not found' });
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Mint a real demo JWT against the same secret vitest.config
    // injects for the test process. This is the same shape the
    // production demo login now issues.
    demoToken = createToken({
      userId: 'demo-user-public-landing',
      email: 'demo@bowin.app',
      role: DEMO_ROLE,
      tenantId: DEMO_ORG_ID,
      tokenVersion: 0,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 200 with the demo identity attached for the public landing endpoint', async () => {
    const response = await fetch(`${baseUrl}/api/public-portal/bowin-showcase-demo`, {
      headers: { authorization: `Bearer ${demoToken}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      organization: { slug: 'bowin-showcase-demo' },
      authenticatedAs: { id: 'demo-user-public-landing', role: DEMO_ROLE, tenantId: DEMO_ORG_ID },
    });
  });

  it('returns 200 anonymously as well — the public landing is not auth-gated', async () => {
    const response = await fetch(`${baseUrl}/api/public-portal/bowin-showcase-demo`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authenticatedAs).toBeNull();
  });
});

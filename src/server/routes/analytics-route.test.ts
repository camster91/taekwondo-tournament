/**
 * Regression tests for the /api/analytics/tournament/:tournamentId
 * route handler — specifically the auth-after-DB ordering bug.
 *
 * Background: the previous handler called
 *   prisma.tournament.findUnique({ include: { registrations: { include: { competitor: true }}, divisions: { include: { bracket: { include: { matches: true }}}}}})
 * BEFORE checkTournamentAccess, paying the full eager-load cost for
 * every unauthorized request. A malicious user could hammer the
 * endpoint with foreign tournamentIds and DoS the DB; the timing
 * difference between "exists, no access" and "exists, has access"
 * also leaked information about tournament existence.
 *
 * The fix moves the inline checkTournamentAccess call BEFORE the
 * full findUnique. These tests pin the ordering: when access is
 * denied (403 / 404), the expensive findUnique must NEVER have been
 * called.
 *
 * Same mocking pattern as auth-route.test.ts:
 *   - stub `../middleware/auth.js` so we can drive checkTournamentAccess
 *     and requireTournamentAccess from the test
 *   - stub `express` to capture route registrations, so the handler
 *     is reachable without spinning up an Express app
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock state — vi.mock factories run before module imports,
// so any shared state must be reachable from inside the factory.
const mocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(),
  requireTournamentAccess: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  authenticate: (_req: any, _res: any, next: any) => next(),
  // buildTournamentAccessFilter is called by the /dashboard handler
  // — not the route under test, but it has to be stubbed to keep the
  // module import from blowing up.
  buildTournamentAccessFilter: vi.fn(),
}));

type CapturedHandler = {
  method: string;
  path: string;
  middleware: any[];
  handler: any;
};
function getCaptured(): CapturedHandler[] {
  const g = globalThis as any;
  if (!g['__capturedExpressHandlers__']) g['__capturedExpressHandlers__'] = [];
  return g['__capturedExpressHandlers__'];
}

vi.mock('../middleware/auth.js', () => ({
  authenticate: mocks.authenticate,
  requireTournamentAccess: mocks.requireTournamentAccess,
  checkTournamentAccess: (...args: any[]) => mocks.checkTournamentAccess(...args),
  buildTournamentAccessFilter: (...args: any[]) =>
    mocks.buildTournamentAccessFilter(...args),
  // analytics.ts also imports the type AuthenticatedRequest — types
  // are erased at runtime, but exporting the symbols keeps the
  // module shape close enough that the test process can import.
}));

vi.mock('express', () => {
  const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
  const fakeRouter: any = {};
  const wrap = (method: string) =>
    (path: string, ...args: any[]) => {
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

// Side-effecting import: registering route handlers.
import '../routes/analytics.js';

const findHandler = (method: string, pathReg: RegExp) => {
  const match = getCaptured().find(
    (h: CapturedHandler) => h.method === method && pathReg.test(h.path),
  );
  if (!match) throw new Error(`No handler for ${method} ${pathReg}`);
  return match;
};

const mockReq = (overrides: any = {}): any => ({
  body: {},
  params: {},
  headers: {},
  app: { locals: { prisma: null } },
  ...overrides,
});

const mockRes = (): any => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res.body = body;
    return res;
  });
  return res;
};

/**
 * Minimal prisma mock. The route only ever calls
 *   prisma.tournament.findUnique(...)
 * (after the fix). The mock records every call so the test can
 * assert whether the expensive query was issued.
 */
const buildPrismaMock = () => {
  const tournament: any = {
    findUnique: vi.fn(),
  };
  return { tournament };
};

beforeEach(() => {
  // Wipe handler capture between tests — module imports are cached,
  // so the handlers themselves are registered once. We only need
  // mock-fn state reset.
  mocks.checkTournamentAccess.mockReset();
});

describe('GET /api/analytics/tournament/:tournamentId — auth-before-DB ordering', () => {
  it('does NOT call the expensive tournament.findUnique when access is denied (403)', async () => {
    // The previous bug: the handler called prisma.tournament.findUnique
    // with full eager-loaded includes BEFORE running checkTournamentAccess.
    // A 403 should now short-circuit before any tournament query.
    mocks.checkTournamentAccess.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'No access to this tournament',
    });

    const prisma = buildPrismaMock();

    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      user: { id: 'u-1', email: 'u@x.com', role: 'viewer' },
      params: { tournamentId: 't-forbidden' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'No access to this tournament' });
    // The whole point of the fix: no tournament query on denied access.
    expect(prisma.tournament.findUnique).not.toHaveBeenCalled();
  });

  it('does NOT call the expensive tournament.findUnique when the tournament is missing (404 from access check)', async () => {
    // checkTournamentAccess returns 404 for missing/soft-deleted
    // tournaments. The handler must not subsequently run the
    // expensive query.
    mocks.checkTournamentAccess.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'Tournament not found',
    });

    const prisma = buildPrismaMock();

    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      user: { id: 'u-1', email: 'u@x.com', role: 'viewer' },
      params: { tournamentId: 't-does-not-exist' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Tournament not found' });
    expect(prisma.tournament.findUnique).not.toHaveBeenCalled();
  });

  it('does NOT call the expensive tournament.findUnique when the user is unauthenticated (401)', async () => {
    // The middleware chain would normally handle this, but the
    // inline checkTournamentAccess also returns 401 if req.user is
    // missing — we test both layers reject without hitting the DB.
    mocks.checkTournamentAccess.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Authentication required',
    });

    const prisma = buildPrismaMock();

    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      // No user — as if authenticate middleware had been bypassed.
      params: { tournamentId: 't-1' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(prisma.tournament.findUnique).not.toHaveBeenCalled();
  });

  it('passes the same tournamentId to checkTournamentAccess as the route param', async () => {
    // The access check must be the one keyed off the URL param,
    // not off some other source — otherwise an attacker could
    // route around it via crafted params.
    mocks.checkTournamentAccess.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'No access to this tournament',
    });

    const prisma = buildPrismaMock();
    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      user: { id: 'u-1', email: 'u@x.com', role: 'viewer' },
      params: { tournamentId: 't-specific-id-1234' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mocks.checkTournamentAccess).toHaveBeenCalledOnce();
    const callArgs = mocks.checkTournamentAccess.mock.calls[0];
    expect(callArgs[2]).toBe('t-specific-id-1234');
    // 4th arg is the minimum role. The route declares 'viewer'.
    expect(callArgs[3]).toBe('viewer');
  });

  it('loads only non-sensitive competitor fields when access is granted', async () => {
    // Positive case — when authorization passes, the route loads only
    // the competitor fields needed for school aggregation. The query
    // must never pull DOB, special-needs, rank, or body measurements
    // into process memory for a viewer analytics request.
    mocks.checkTournamentAccess.mockResolvedValueOnce({ ok: true });

    const prisma = buildPrismaMock();
    prisma.tournament.findUnique.mockResolvedValueOnce({
      id: 't-1',
      name: 'Open',
      registrations: [
        {
          patterns: true,
          sparring: false,
          checkedIn: true,
          competitor: {
            id: 'c-1',
            firstName: 'Pat',
            lastName: 'Lee',
            schoolDojang: 'Safe Dojang',
          },
        },
      ],
      divisions: [],
    });

    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      user: { id: 'u-1', email: 'u@x.com', role: 'viewer' },
      params: { tournamentId: 't-1' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(prisma.tournament.findUnique).toHaveBeenCalledOnce();

    // Lock in the data-minimized include shape. A regression to
    // `competitor: true` would fetch every sensitive Competitor field.
    const call = prisma.tournament.findUnique.mock.calls[0][0];
    expect(call.where).toEqual({ id: 't-1', deletedAt: null });
    expect(call.include.registrations.include).toEqual({
      competitor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          schoolDojang: true,
        },
      },
    });
    expect(call.include.divisions.include).toEqual({
      bracket: { include: { matches: true } },
    });

    expect(res.body).toEqual({
      tournamentId: 't-1',
      name: 'Open',
      registrations: {
        total: 1,
        patterns: 1,
        sparring: 0,
        checkedIn: 1,
        checkInRate: 100,
      },
      divisions: {
        total: 0,
        byType: { patterns: 0, sparring: 0 },
        stats: [],
      },
      topSchools: [{ school: 'Safe Dojang', count: 1 }],
    });
    const serializedResponse = JSON.stringify(res.body);
    for (const sensitiveField of [
      'dateOfBirth',
      'specialNeeds',
      'danRank',
      'weightLbs',
      'heightInches',
      'reachInches',
    ]) {
      expect(serializedResponse).not.toContain(sensitiveField);
    }
  });

  it('returns 404 (not 500) when access passed but tournament is gone between check and query', async () => {
    // Race: tournament is hard-deleted in the window between
    // checkTournamentAccess and the subsequent findUnique. The
    // explicit post-access 404 branch must still exist to convert
    // a null result into a clean 404 — otherwise prisma will throw
    // on downstream property access. (Same error message as the
    // access-check 404, so callers see one consistent shape.)
    mocks.checkTournamentAccess.mockResolvedValueOnce({ ok: true });

    const prisma = buildPrismaMock();
    prisma.tournament.findUnique.mockResolvedValueOnce(null);

    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      user: { id: 'u-1', email: 'u@x.com', role: 'admin' },
      params: { tournamentId: 't-deleted-mid-flight' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Tournament not found' });
  });

  it('falls back to status 403 when access result omits an explicit status code', async () => {
    // Defensive: checkTournamentAccess contract guarantees a
    // status, but the handler's `access.status || 403` defends
    // against a future regression. Pin the fallback so a code
    // change doesn't accidentally turn this into a 500.
    mocks.checkTournamentAccess.mockResolvedValueOnce({
      ok: false,
      error: 'Boom',
    });

    const prisma = buildPrismaMock();
    const handler = findHandler('get', /\/tournament\/:tournamentId$/).handler;
    const req = mockReq({
      user: { id: 'u-1', email: 'u@x.com', role: 'viewer' },
      params: { tournamentId: 't-1' },
      app: { locals: { prisma } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(prisma.tournament.findUnique).not.toHaveBeenCalled();
  });
});

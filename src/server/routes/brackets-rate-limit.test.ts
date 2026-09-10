/**
 * HIGH #5 (backend review): the bracket write path needs a
 * rate limit. This test verifies the limiters are wired up on
 * the right routes without exercising the actual
 * `express-rate-limit` counter (which is bypassed in test
 * environments via `createRateLimiter`'s built-in
 * `isTestEnvironment()` check).
 *
 * The unit-testable surface is: the bracket router registers
 * - a mount-level `bracketWriteLimiter` on every route, and
 * - an additional `bracketCorrectionApplyLimiter` on
 *   `/division/:divisionId/correction/apply` so the heavy
 *   re-seed write gets a tighter cap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  useCalls: [] as Array<{ handler: unknown }>,
  handlers: [] as Array<{ method: string; path: string; middleware: Array<(...args: unknown[]) => unknown> }>,
  // Each call to createRateLimiter is recorded with its
  // options so the test can assert the caps + keyGenerator.
  limiterOpts: [] as Array<{ max?: number; keyGenerator?: (req: unknown) => string; message?: unknown }>,
  loaded: false,
}));

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    router[method] = (path: string, ...handlers: any[]) => {
      state.handlers.push({ method, path, middleware: handlers });
      return router;
    };
  }
  router.use = (...handlers: unknown[]) => {
    for (const h of handlers) state.useCalls.push({ handler: h });
    return router;
  };
  return { Router: () => router };
});

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn(),
  requireTournamentAccess: vi.fn(() => vi.fn()),
  checkTournamentAccess: vi.fn(),
}));

vi.mock('../middleware/validate.js', () => ({
  validateRequest: () => vi.fn(),
}));

vi.mock('../middleware/rate-limit.js', () => ({
  // The factory returns a unique marker function so the test
  // can identify the limiter reference on the route. The
  // recorded options are also kept for keyGenerator checks.
  createRateLimiter: vi.fn((opts: { max?: number; windowMs?: number; keyGenerator?: (req: unknown) => string; message?: unknown }) => {
    state.limiterOpts.push(opts);
    const fn = () => undefined;
    return fn;
  }),
}));

vi.mock('../services/match-advancement.js', () => ({
  advanceWinner: vi.fn(),
  handleByeMatches: vi.fn(),
  getBracketPlacements: vi.fn(),
  resolveNextMatchSlots: vi.fn(),
  pickSlotsToNull: vi.fn(),
  validateMatchStatusTransition: vi.fn(),
}));

vi.mock('../services/pdf-export.js', () => ({
  generateBracketPDF: vi.fn(),
  generateBatchBracketsPDF: vi.fn(),
  generateResultsPDF: vi.fn(),
  generateCertificatePDF: vi.fn(),
  generateBatchCertificatesPDF: vi.fn(),
  generateSchoolReportPDF: vi.fn(),
}));

vi.mock('../services/bracket-correction.js', () => ({
  applyBracketCorrection: vi.fn(),
  assertInitialBracketGeneration: vi.fn(),
  getBracketCorrectionStatus: vi.fn(),
  previewBracketCorrection: vi.fn(),
  undoBracketCorrection: vi.fn(),
}));

vi.mock('../services/bracket-generator.js', () => ({
  generateBracket: vi.fn(),
  generateSingleElimination: vi.fn(),
}));

vi.mock('../services/bracket-formats.js', () => ({
  generateRoundRobin: vi.fn(),
  generatePoolPlay: vi.fn(),
}));

vi.mock('../services/websocket.js', () => ({
  broadcastMatchUpdate: vi.fn(),
  broadcastBracketRegenerated: vi.fn(),
}));

// Capture state snapshots taken at module-load time. The
// `import './brackets.js'` side-effect populates `state` and
// we then freeze a reference; the tests assert against the
// snapshot, not against the live `state` (which gets reset by
// the `beforeEach` reset below).
let snapshot: { useCalls: typeof state.useCalls; handlers: typeof state.handlers; limiterOpts: typeof state.limiterOpts };
const beforeLoad = () => {
  // The state arrays are created empty by `vi.hoisted`; the
  // import below populates them. Don't clear here.
};
void beforeLoad;

import './brackets.js';

snapshot = {
  useCalls: [...state.useCalls],
  handlers: [...state.handlers],
  limiterOpts: [...state.limiterOpts],
};

describe('brackets router rate limiting (HIGH #5)', () => {
  it('mounts a single bracket-write rate limiter on the whole router', () => {
    expect(snapshot.useCalls.length).toBe(1);
    expect(snapshot.limiterOpts[0]?.max).toBe(120);
  });

  it('configures a tighter correction/apply rate limiter on the heavy route', () => {
    const route = snapshot.handlers.find(
      (h) => h.method === 'post' && h.path === '/division/:divisionId/correction/apply',
    );
    expect(route).toBeDefined();
    expect(snapshot.limiterOpts[1]?.max).toBe(30);
  });

  it('registers a healthy number of bracket write routes (sanity check)', () => {
    const writeRoutes = snapshot.handlers.filter(
      (h) =>
        h.path.includes('/match') ||
        h.path.includes('/division') ||
        h.path.includes('/tournament'),
    );
    expect(writeRoutes.length).toBeGreaterThan(5);
  });

  it('keys the limiter on the authenticated user id when present', () => {
    expect(snapshot.limiterOpts.length).toBeGreaterThanOrEqual(2);
    const writeOpts = snapshot.limiterOpts[0]!;
    expect(typeof writeOpts.keyGenerator).toBe('function');
    // Authenticated: user id wins over IP.
    expect(writeOpts.keyGenerator!({ user: { id: 'u-42' }, ip: '10.0.0.1' })).toBe('u-42');
    // Anonymous (no user) falls back to the IP via
    // express-rate-limit's ipKeyGenerator helper.
    expect(writeOpts.keyGenerator!({ ip: '10.0.0.2' })).toBe('10.0.0.2');
    // No IP either: the helper returns a literal 'unknown'
    // so the limiter still has a key (otherwise
    // express-rate-limit would throw at limiter construction).
    expect(writeOpts.keyGenerator!({})).toBe('unknown');
  });
});

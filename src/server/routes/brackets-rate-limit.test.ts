import { describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const state = vi.hoisted(() => ({
  routes: [] as Array<{ method: string; path: string; handlers: Handler[] }>,
  writeLimiter: Object.assign(() => undefined, { limiterKind: 'write' }),
  rebuildLimiter: Object.assign(() => undefined, { limiterKind: 'rebuild' }),
  authenticate: () => undefined,
}));

vi.mock('express', () => {
  const router: Record<string, unknown> = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (path: string, ...handlers: Handler[]) => {
      state.routes.push({ method, path, handlers });
      return router;
    };
  }
  return { Router: () => router };
});

vi.mock('../middleware/bracket-rate-limit.js', () => ({
  createBracketWriteLimiter: () => state.writeLimiter,
  createBracketRebuildLimiter: () => state.rebuildLimiter,
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: state.authenticate,
  requireTournamentAccess: () => () => undefined,
  checkTournamentAccess: vi.fn(),
}));

await import('./brackets.js');

const route = (method: string, path: string) => {
  const found = state.routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`${method.toUpperCase()} ${path} not registered`);
  return found;
};

describe('bracket write routes are rate limited after authentication', () => {
  const matchWrites: Array<[string, string]> = [
    ['put', '/match/:matchId'],
    ['post', '/match/:matchId/swap'],
    ['post', '/match/:matchId/undo'],
    ['patch', '/match/:matchId/video'],
    ['post', '/division/:divisionId/correction/preview'],
  ];
  const rebuilds: Array<[string, string]> = [
    ['post', '/division/:divisionId/generate'],
    ['post', '/tournament/:tournamentId/generate-all'],
    ['post', '/division/:divisionId/reset'],
    ['post', '/division/:divisionId/correction/apply'],
    ['post', '/division/:divisionId/correction/undo/:auditId'],
  ];

  it.each(matchWrites)('%s %s uses the match-write limiter right after authenticate', (method, path) => {
    const { handlers } = route(method, path);
    expect(handlers[0]).toBe(state.authenticate);
    expect(handlers[1]).toBe(state.writeLimiter);
  });

  it.each(rebuilds)('%s %s uses the tighter rebuild limiter right after authenticate', (method, path) => {
    const { handlers } = route(method, path);
    expect(handlers[0]).toBe(state.authenticate);
    expect(handlers[1]).toBe(state.rebuildLimiter);
  });

  it('leaves every mutating bracket route covered by a limiter', () => {
    const limiters: Handler[] = [state.writeLimiter, state.rebuildLimiter];
    const uncovered = state.routes
      .filter((r) => r.method !== 'get')
      .filter((r) => !r.handlers.some((h) => limiters.includes(h)))
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(uncovered).toEqual([]);
  });

  it('does not throttle read-only routes such as bracket polling and PDFs', () => {
    const limiters: Handler[] = [state.writeLimiter, state.rebuildLimiter];
    const throttledReads = state.routes
      .filter((r) => r.method === 'get')
      .filter((r) => r.handlers.some((h) => limiters.includes(h)));
    expect(throttledReads).toEqual([]);
  });
});

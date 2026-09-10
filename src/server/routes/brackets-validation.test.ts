import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => [] as Array<{
  method: string;
  path: string;
  middleware: Array<(...args: any[]) => any>;
}>);

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    router[method] = (path: string, ...handlers: any[]) => {
      captured.push({ method, path, middleware: handlers.slice(0, -1) });
      return router;
    };
  }
  // `brackets.ts` registers a mount-level rate limiter via
  // `router.use(...)` (HIGH #5 fix). The mock has to satisfy
  // the call or the module load will throw before any test
  // body runs.
  router.use = () => router;
  return { Router: () => router };
});

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn(),
  requireTournamentAccess: vi.fn(() => vi.fn()),
  checkTournamentAccess: vi.fn(),
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

import './brackets.js';

describe.skip('match result validation', () => {
  it('accepts winnerId null so a completed result can be cleared safely', () => {
    const route = captured.find(
      (candidate) => candidate.method === 'put' && candidate.path === '/match/:matchId'
    );
    if (!route) throw new Error('match route not registered');
    const validator = route.middleware[1];
    const req: any = { body: { winnerId: null, status: 'pending' } };
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();

    validator(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

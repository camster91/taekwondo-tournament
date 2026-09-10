import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: [] as Array<{ method: string; path: string; handler: (...args: any[]) => any }>,
  transactionActive: false,
  advanceInsideTransaction: false,
}));

vi.mock('express', () => {
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (path: string, ...handlers: any[]) => {
      state.handlers.push({ method, path, handler: handlers.at(-1) });
      return router;
    };
  }
  return { Router: () => router };
});

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireTournamentAccess: () => (_req: any, _res: any, next: any) => next(),
  checkTournamentAccess: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../middleware/validate.js', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/match-advancement.js', () => ({
  advanceWinner: vi.fn().mockImplementation(async () => {
    state.advanceInsideTransaction = state.transactionActive;
    return { advanced: true, message: 'advanced' };
  }),
  handleByeMatches: vi.fn(),
  getBracketPlacements: vi.fn(),
  resolveNextMatchSlots: vi.fn(),
  pickSlotsToNull: vi.fn(),
  validateMatchStatusTransition: vi.fn().mockReturnValue({ ok: true }),
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

const handler = () => {
  const captured = state.handlers.find(
    (candidate) => candidate.method === 'put' && candidate.path === '/match/:matchId'
  );
  if (!captured) throw new Error('match update handler not registered');
  return captured.handler;
};

const currentMatch = {
  id: 'match-1',
  bracketId: 'bracket-1',
  bracketType: 'winners',
  matchNumber: 1,
  competitor1Id: 'registration-1',
  competitor2Id: 'registration-2',
  winnerId: null,
  scores: null,\n  status: 'ready',
  updatedAt: new Date('2026-08-07T12:00:00.000Z'),
};

const updatedMatch = {
  ...currentMatch,
  winnerId: 'registration-1',
  scores: { score1: '5', score2: '2' },
  status: 'completed',
  bracket: { id: 'bracket-1' },
};

function response() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe.skip('PUT /match/:matchId concurrency safety', () => {
  beforeEach(() => {
    state.transactionActive = false;
    state.advanceInsideTransaction = false;
  });

  it('uses an updatedAt compare-and-swap and advances inside the same transaction', async () => {
    const tx = {
      match: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(updatedMatch),
      },
      matchAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      match: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ bracket: { division: { tournamentId: 'tournament-1' } } })
          .mockResolvedValueOnce(currentMatch),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        state.transactionActive = true;
        try {
          return await callback(tx);
        } finally {
          state.transactionActive = false;
        }
      }),
    };
    const req: any = {
      params: { matchId: 'match-1' },
      body: {
        winnerId: 'registration-1',
        scores: { score1: '5', score2: '2' },
        status: 'completed',
      },
      user: { id: 'scorekeeper-1', email: 'scorekeeper@example.com' },
      app: { locals: { prisma } },
    };

    await handler()(req, response());

    expect(tx.match.updateMany).toHaveBeenCalledWith({
      where: { id: 'match-1', updatedAt: currentMatch.updatedAt },
      data: {
        winnerId: 'registration-1',
        // The handler stringifies the scores object before writing.
        scores: JSON.stringify({ score1: '5', score2: '2' }),
        status: 'completed',
      },
    });
    expect(state.advanceInsideTransaction).toBe(true);
  });

  it('rejects a winner that contradicts numeric scores unless an override reason is supplied', async () => {
    const prisma = {
      match: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ bracket: { division: { tournamentId: 'tournament-1' } } })
          .mockResolvedValueOnce(currentMatch),
      },
      $transaction: vi.fn(),
    };
    const req: any = {
      params: { matchId: 'match-1' },
      body: {
        winnerId: 'registration-1',
        // SH-4: scores carries the numeric payload.
        scores: { score1: '2', score2: '5' },
        status: 'completed',
      },
      user: { id: 'scorekeeper-1', email: 'scorekeeper@example.com' },
      app: { locals: { prisma } },
    };
    const res = response();

    await handler()(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Winner contradicts the recorded score. Set manualOverride=true with an overrideReason, or correct the scores.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});





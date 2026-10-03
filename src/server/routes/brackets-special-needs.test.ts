/**
 * GET /api/brackets/match/:matchId/special-needs: the scorekeeper sees the
 * notes of the two people in the match being scored, nothing else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const accessMocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(async () => ({ ok: true }) as { ok: boolean; status?: number; error?: string }),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireTournamentAccess: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkTournamentAccess: accessMocks.checkTournamentAccess,
}));

vi.mock('../services/match-advancement.js', () => ({
  handleByeMatches: vi.fn(),
  getBracketPlacements: vi.fn(),
  validateMatchStatusTransition: vi.fn(),
  lockBracket: vi.fn(),
  syncBracketAdvancement: vi.fn(),
  summarizeBracketUpdates: vi.fn(),
}));

vi.mock('../services/websocket.js', () => ({
  broadcastMatchUpdate: vi.fn(),
  broadcastBracketRegenerated: vi.fn(),
}));

import bracketsRouter from './brackets.js';

function makeApp(match: unknown) {
  const findUnique = vi.fn(async () => match);
  const app = express();
  app.use(express.json());
  app.locals.prisma = { match: { findUnique } };
  app.use('/api/brackets', bracketsRouter);
  return { app, findUnique };
}

const scoredMatch = {
  bracket: { division: { tournamentId: 't-1', deletedAt: null } },
  competitor1: { id: 'r1', specialNeeds: 'Quiet warm-up', competitor: { firstName: 'Ana', lastName: 'Lee', specialNeeds: null } },
  competitor2: { id: 'r2', specialNeeds: null, competitor: { firstName: 'Bo', lastName: 'Kim', specialNeeds: null } },
};

describe('GET /api/brackets/match/:matchId/special-needs', () => {
  beforeEach(() => {
    accessMocks.checkTournamentAccess.mockReset();
    accessMocks.checkTournamentAccess.mockResolvedValue({ ok: true });
  });

  it('returns only the match competitors who have a note, at scorekeeper level', async () => {
    const { app, findUnique } = makeApp(scoredMatch);
    const res = await request(app).get('/api/brackets/match/m-1/special-needs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ competitors: [{ registrationId: 'r1', name: 'Ana Lee', note: 'Quiet warm-up' }] });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(accessMocks.checkTournamentAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 't-1', 'scorekeeper');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm-1' } }));
  });

  it('refuses people below scorekeeper (viewers)', async () => {
    accessMocks.checkTournamentAccess.mockResolvedValue({ ok: false, status: 403, error: 'Insufficient permissions' });
    const { app } = makeApp(scoredMatch);
    const res = await request(app).get('/api/brackets/match/m-1/special-needs');
    expect(res.status).toBe(403);
    expect(res.body.competitors).toBeUndefined();
  });

  it('answers 404 for a missing match or a deleted division', async () => {
    expect((await request(makeApp(null).app).get('/api/brackets/match/nope/special-needs')).status).toBe(404);
    const deleted = { ...scoredMatch, bracket: { division: { tournamentId: 't-1', deletedAt: new Date() } } };
    expect((await request(makeApp(deleted).app).get('/api/brackets/match/m-1/special-needs')).status).toBe(404);
    expect(accessMocks.checkTournamentAccess).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { buildScoreResultPayload } from './score-result-payload';

describe('buildScoreResultPayload', () => {
  it('omits blank scores instead of sending ""', () => {
    const payload = buildScoreResultPayload({ matchId: 'm', winnerId: 'w', score1: '', score2: ' ', notes: 'FORFEIT' });
    expect(payload).toEqual({ winnerId: 'w', status: 'completed', notes: 'FORFEIT' });
    expect(JSON.stringify(payload)).not.toContain('score');
  });

  it('carries the rendered match version for conflict detection', () => {
    const payload = buildScoreResultPayload({
      matchId: 'm', winnerId: 'w', score1: '5', score2: '3', notes: '', expectedUpdatedAt: '2026-08-07T12:00:00.000Z',
    });
    expect(payload).toEqual({
      winnerId: 'w',
      status: 'completed',
      notes: '',
      score1: '5',
      score2: '3',
      expectedUpdatedAt: '2026-08-07T12:00:00.000Z',
    });
  });
});

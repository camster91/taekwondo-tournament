import { describe, expect, it } from 'vitest';
import { broadcastMatchPayload } from './websocket.js';

describe('broadcastMatchPayload', () => {
  it('keeps match state and drops registration and competitor rows', () => {
    const payload = broadcastMatchPayload({
      id: 'm1',
      matchNumber: 3,
      bracketType: 'winners',
      status: 'completed',
      competitor1Id: 'r1',
      competitor2Id: 'r2',
      winnerId: 'r1',
      score1: 5,
      score2: 2,
      competitor1: { id: 'r1', parentEmail: 'parent@example.com', parentPhone: '555', specialNeeds: 'Hearing aid', competitor: { firstName: 'A' } },
      competitor2: { id: 'r2', parentEmail: 'other@example.com' },
      winner: { id: 'r1', parentEmail: 'parent@example.com' },
      bracket: { id: 'b1', structure: '{}' },
    });

    expect(payload).toEqual({
      id: 'm1',
      matchNumber: 3,
      bracketType: 'winners',
      status: 'completed',
      competitor1Id: 'r1',
      competitor2Id: 'r2',
      winnerId: 'r1',
      score1: 5,
      score2: 2,
    });
    expect(JSON.stringify(payload)).not.toMatch(/parent|Hearing|example\.com/);
  });

  it('tolerates a missing match', () => {
    expect(broadcastMatchPayload(null)).toEqual({});
  });
});

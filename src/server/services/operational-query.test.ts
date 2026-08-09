import { describe, expect, it } from 'vitest';
import { answerOperationalQuery, buildRingDelayOperationalAnswer, buildUnsupportedOperationalAnswer, parseOperationalQuery } from './operational-query.js';

describe('parseOperationalQuery', () => {
  it('recognizes the supported read-only operational questions', () => {
    expect(parseOperationalQuery('Which divisions are blocked?')).toEqual({ kind: 'blocked_divisions' });
    expect(parseOperationalQuery('Who competes in the next 20 minutes?')).toEqual({ kind: 'next_competitors', windowMinutes: 20 });
    expect(parseOperationalQuery('Why is Ring 3 late?')).toEqual({ kind: 'ring_delay', ring: 3 });
    expect(parseOperationalQuery('Which schools need to check in?')).toEqual({ kind: 'schools_need_checkin' });
  });

  it('fails closed for mutation-like, ambiguous, and out-of-range requests', () => {
    expect(parseOperationalQuery('Move Ring 3 matches to Ring 1')).toEqual({ kind: 'unsupported' });
    expect(parseOperationalQuery('Who is next?')).toEqual({ kind: 'unsupported' });
    expect(parseOperationalQuery('Who competes in the next 999 minutes?')).toEqual({ kind: 'unsupported' });
  });

  it('returns a timestamped, non-mutating explanation for unsupported requests', () => {
    expect(buildUnsupportedOperationalAnswer(new Date('2026-08-09T15:00:00.000Z'))).toEqual({
      answer: 'I can answer: which divisions are blocked, who competes in the next number of minutes, why a ring is late, or which schools need check-in.',
      generatedAt: '2026-08-09T15:00:00.000Z',
      evidence: [],
    });
  });

  it('answers a recorded ring delay with timestamped, linked evidence', () => {
    expect(buildRingDelayOperationalAnswer({
      tournamentId: 'tournament-1', ring: 3, delayedMatches: [{ label: 'Junior Sparring, match 12', observedAt: '2026-08-09T14:45:00.000Z' }],
    }, new Date('2026-08-09T15:00:00.000Z'))).toEqual({
      answer: 'Ring 3 may be late because 1 match has remained in progress for more than ten minutes.',
      generatedAt: '2026-08-09T15:00:00.000Z',
      evidence: [{ label: 'Junior Sparring, match 12', href: '/tournaments/tournament-1/director', observedAt: '2026-08-09T14:45:00.000Z' }],
    });
  });

  it('does not query tournament data for an unsupported request', async () => {
    const prisma = { tournament: { findUnique: () => { throw new Error('must not query'); } } };
    await expect(answerOperationalQuery(prisma as never, 'tournament-1', 'Move matches now', new Date('2026-08-09T15:00:00.000Z')))
      .resolves.toEqual(buildUnsupportedOperationalAnswer(new Date('2026-08-09T15:00:00.000Z')));
  });
});

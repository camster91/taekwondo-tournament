import { describe, expect, it } from 'vitest';
import { buildUnsupportedOperationalAnswer, parseOperationalQuery } from './operational-query.js';

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
});

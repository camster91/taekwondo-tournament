import { describe, expect, it } from 'vitest';
import { parseOperationalQuery } from './operational-query.js';

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
});

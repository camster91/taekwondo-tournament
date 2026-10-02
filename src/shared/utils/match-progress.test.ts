import { describe, expect, it } from 'vitest';
import { BYE_NOTE, countMatchProgress, isByeMatch } from './match-progress';

const a = '00000000-0000-4000-8000-00000000000a';
const b = '00000000-0000-4000-8000-00000000000b';

describe('isByeMatch', () => {
  it('flags auto-resolved byes with one or no entrant', () => {
    expect(isByeMatch({ status: 'completed', notes: BYE_NOTE, competitor1Id: a, competitor2Id: null })).toBe(true);
    expect(isByeMatch({ status: 'completed', notes: BYE_NOTE, competitor1Id: null, competitor2Id: null })).toBe(true);
  });

  it('does not flag real results, forfeits or unplayed matches', () => {
    expect(isByeMatch({ status: 'completed', notes: null, competitor1Id: a, competitor2Id: b })).toBe(false);
    expect(isByeMatch({ status: 'completed', notes: 'Forfeit', competitor1Id: a, competitor2Id: b })).toBe(false);
    expect(isByeMatch({ status: 'pending', notes: null, competitor1Id: null, competitor2Id: null })).toBe(false);
    // A payload without notes is never treated as a bye.
    expect(isByeMatch({ status: 'completed', competitor1Id: a, competitor2Id: null })).toBe(false);
  });
});

describe('countMatchProgress', () => {
  it('leaves byes out of both the total and the completed count', () => {
    expect(countMatchProgress([
      { status: 'completed', notes: BYE_NOTE, competitor1Id: a, competitor2Id: null },
      { status: 'completed', notes: null, competitor1Id: a, competitor2Id: b },
      { status: 'ready', notes: null, competitor1Id: a, competitor2Id: b },
      { status: 'pending', notes: null, competitor1Id: null, competitor2Id: null },
    ])).toEqual({ total: 3, completed: 1 });
  });
});

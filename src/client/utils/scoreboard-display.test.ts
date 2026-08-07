import { describe, expect, it } from 'vitest';
import { resolveDisplayRing } from './scoreboard-display';

describe('scoreboard display selection', () => {
  it('cycles to a new ring on every cycle tick', () => {
    expect(resolveDisplayRing({}, [1, 2, 3], true, 'all', 0)).toBe(1);
    expect(resolveDisplayRing({}, [1, 2, 3], true, 'all', 1)).toBe(2);
    expect(resolveDisplayRing({}, [1, 2, 3], true, 'all', 2)).toBe(3);
  });

  it('gives the director ring override precedence over local controls', () => {
    expect(resolveDisplayRing({ mode: 'ring:4' }, [1, 2, 4], true, 2, 1)).toBe(4);
    expect(resolveDisplayRing({ ringNumber: 3 }, [1, 3], false, 'all', 0)).toBe(3);
  });

  it('honors director all mode and a local manual choice', () => {
    expect(resolveDisplayRing({ mode: 'all' }, [1, 2], true, 1, 1)).toBe('all');
    expect(resolveDisplayRing({}, [1, 2], false, 2, 0)).toBe(2);
  });
});

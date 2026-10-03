import { describe, it, expect } from 'vitest';
import { countSameSchoolFirstRound, describeSameSchoolFights, normalizeSchool } from './same-school';

const match = (matchNumber: number, a: string | null, b: string | null, roundNumber = 1, bracketType = 'winners') =>
  ({ matchNumber, roundNumber, bracketType, competitor1Id: a, competitor2Id: b });

const schools: Record<string, string | null> = {
  a1: 'Newtons TKD', a2: ' newtons  tkd ', a3: 'NEWTONS TKD', b1: 'Tiger Dojang', b2: 'Tiger Dojang', x: null, y: '',
};
const schoolOf = (id: string) => schools[id];

describe('countSameSchoolFirstRound', () => {
  it('counts round-1 fights between team-mates, ignoring case and spacing', () => {
    const result = countSameSchoolFirstRound('double_elim', [
      match(1, 'a1', 'a2'),
      match(2, 'b1', 'b2'),
      match(3, 'a3', 'b1'),
      match(4, 'a1', null),          // bye: not a fight
      match(5, 'a1', 'a3', 2),       // round 2: not counted
      match(6, 'b1', 'b2', 1, 'losers'),
    ], schoolOf)!;
    expect(result.count).toBe(2);
    expect(result.fights).toBe(3);
    expect(result.matches).toEqual([
      { matchNumber: 1, school: 'Newtons TKD' },
      { matchNumber: 2, school: 'Tiger Dojang' },
    ]);
  });

  it('never pairs unknown schools', () => {
    expect(countSameSchoolFirstRound('single_elim', [match(1, 'x', 'y'), match(2, 'y', 'y')], schoolOf)!.count).toBe(0);
  });

  it('counts the single final of a 2-person single elimination', () => {
    expect(countSameSchoolFirstRound('single_elim', [match(1, 'b1', 'b2', 1, 'finals')], schoolOf)!.count).toBe(1);
  });

  it('reports how many fights cannot be avoided', () => {
    // 3 fights, one school has 5 of the 6 places: at least 2 team-mate fights.
    const result = countSameSchoolFirstRound('double_elim', [
      match(1, 'a1', 'a2'), match(2, 'a3', 'a1'), match(3, 'a2', 'b1'),
    ], schoolOf)!;
    expect(result.unavoidable).toBe(2);
    expect(result.count).toBe(2);
  });

  it('returns null for round robin and pool play', () => {
    expect(countSameSchoolFirstRound('round_robin', [match(1, 'a1', 'a2')], schoolOf)).toBeNull();
    expect(countSameSchoolFirstRound('pool_play', [match(1, 'a1', 'a2')], schoolOf)).toBeNull();
  });
});

describe('describeSameSchoolFights', () => {
  it('uses plain words', () => {
    expect(describeSameSchoolFights(0)).toBe('No first-round fights between team-mates');
    expect(describeSameSchoolFights(1)).toBe('1 first-round fight between team-mates');
    expect(describeSameSchoolFights(2)).toBe('2 first-round fights between team-mates');
  });
});

describe('normalizeSchool', () => {
  it('trims, collapses spaces and lower-cases', () => {
    expect(normalizeSchool('  Newtons   TKD ')).toBe('newtons tkd');
    expect(normalizeSchool(null)).toBe('');
  });
});

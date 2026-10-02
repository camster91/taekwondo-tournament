import { describe, expect, it } from 'vitest';
import {
  EMPTY_PICKER_FILTERS,
  ageOn,
  beltOrder,
  filterCompetitors,
  schoolOptions,
  sortCompetitors,
  type PickerCompetitor,
} from './competitor-picker';

const day = new Date('2026-06-15T00:00:00Z');
const c = (id: string, over: Partial<PickerCompetitor>): PickerCompetitor => ({
  id, firstName: id, lastName: 'X', gender: 'M', belt: 'White', danRank: null, weightLbs: null, schoolDojang: null, dateOfBirth: null, ...over,
});

const list = [
  c('ava', { gender: 'F', belt: 'Yellow / Single Green Stripe', weightLbs: 60, schoolDojang: 'North', dateOfBirth: '2016-07-01' }),
  c('ben', { gender: 'M', belt: 'Black', danRank: 2, weightLbs: 140, schoolDojang: 'South ', dateOfBirth: '2008-01-10' }),
  c('cai', { gender: 'M', belt: 'Green', weightLbs: 85, schoolDojang: 'North', dateOfBirth: '2014-06-15' }),
  c('dee', { gender: 'F', belt: 'White' }),
];

describe('ageOn', () => {
  it('counts whole years on the tournament day', () => {
    expect(ageOn('2016-07-01', day)).toBe(9); // birthday not reached yet
    expect(ageOn('2014-06-15', day)).toBe(12); // birthday today
    expect(ageOn(null, day)).toBeNull();
    expect(ageOn('nope', day)).toBeNull();
  });
});

describe('filterCompetitors', () => {
  const run = (over: Partial<typeof EMPTY_PICKER_FILTERS>) =>
    filterCompetitors(list, { ...EMPTY_PICKER_FILTERS, ...over }, day).map((x) => x.id);

  it('returns everyone with no filters', () => {
    expect(run({})).toEqual(['ava', 'ben', 'cai', 'dee']);
  });

  it('filters by gender, age range, belt, weight range and school', () => {
    expect(run({ gender: 'F' })).toEqual(['ava', 'dee']);
    expect(run({ ageMin: '9', ageMax: '12' })).toEqual(['ava', 'cai']);
    expect(run({ belts: ['Yellow', 'Green'] })).toEqual(['ava', 'cai']);
    expect(run({ weightMin: '80', weightMax: '150' })).toEqual(['ben', 'cai']);
    expect(run({ school: 'South' })).toEqual(['ben']);
    expect(run({ search: 'north' })).toEqual(['ava', 'cai']);
  });

  it('combines filters and leaves out people with unknown age or weight for those ranges', () => {
    expect(run({ gender: 'M', ageMax: '12', weightMin: '50' })).toEqual(['cai']);
    expect(run({ ageMin: '0' })).not.toContain('dee');
    expect(run({ weightMax: '500' })).not.toContain('dee');
  });
});

describe('sortCompetitors', () => {
  it('sorts by age, weight and belt, with missing values last', () => {
    expect(sortCompetitors(list, 'age', 'asc', day).map((x) => x.id)).toEqual(['ava', 'cai', 'ben', 'dee']);
    expect(sortCompetitors(list, 'weight', 'desc', day).map((x) => x.id)).toEqual(['ben', 'cai', 'ava', 'dee']);
    expect(sortCompetitors(list, 'belt', 'asc', day).map((x) => x.id)).toEqual(['dee', 'ava', 'cai', 'ben']);
  });

  it('orders black belts by dan after every colour belt', () => {
    expect(beltOrder('Black', 1)).toBeGreaterThan(beltOrder('Brown / Double Black Stripe', null));
    expect(beltOrder('Black', 3)).toBeGreaterThan(beltOrder('Black', 1));
  });
});

describe('schoolOptions', () => {
  it('lists distinct trimmed school names', () => {
    expect(schoolOptions(list)).toEqual(['North', 'South']);
  });
});

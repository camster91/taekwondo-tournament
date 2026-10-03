import { describe, expect, it } from 'vitest';
import { createSchoolResolver, dominantSchool, isSameSchool, normalizeSchoolName } from './school';

describe('normalizeSchoolName', () => {
  it('ignores case, spacing, apostrophes and punctuation', () => {
    expect(normalizeSchoolName("Newton's  T.K.D.")).toBe('newtons tkd');
    expect(normalizeSchoolName('  NEWTONS tkd ')).toBe('newtons tkd');
    expect(normalizeSchoolName('Newtons-TKD')).toBe('newtons tkd');
    expect(normalizeSchoolName('Newtons TKD (Markham)')).toBe('newtons tkd markham');
  });

  it('removes accents', () => {
    expect(normalizeSchoolName('École Taekwondo')).toBe('ecole taekwondo');
  });

  it('returns an empty key for missing names', () => {
    expect(normalizeSchoolName(null)).toBe('');
    expect(normalizeSchoolName(undefined)).toBe('');
    expect(normalizeSchoolName('  ...  ')).toBe('');
  });
});

describe('createSchoolResolver', () => {
  it('maps organizer aliases onto one school', () => {
    const resolver = createSchoolResolver([{ alias: 'Newtons TKD (Markham)', school: 'Newtons TKD' }]);
    expect(resolver.key('newtons tkd (markham)')).toBe(resolver.key("Newton's TKD"));
    expect(resolver.label('Newtons TKD (Markham)')).toBe('Newtons TKD');
    // A name with no alias keeps how it was typed.
    expect(resolver.label(' Other Dojang ')).toBe('Other Dojang');
  });

  it('follows chained aliases and stops on loops', () => {
    const chained = createSchoolResolver([
      { alias: 'A North', school: 'A Central' },
      { alias: 'A Central', school: 'A HQ' },
    ]);
    expect(chained.key('A North')).toBe('a hq');
    expect(chained.label('A North')).toBe('A HQ');

    const looped = createSchoolResolver([
      { alias: 'X', school: 'Y' },
      { alias: 'Y', school: 'X' },
    ]);
    expect(['x', 'y']).toContain(looped.key('X'));
  });

  it('ignores blank or self-referencing aliases', () => {
    const resolver = createSchoolResolver([
      { alias: '', school: 'Newtons TKD' },
      { alias: 'Newtons TKD', school: 'newtons tkd' },
    ]);
    expect(resolver.key('Newtons TKD')).toBe('newtons tkd');
    expect(resolver.key('')).toBe('');
  });
});

describe('isSameSchool', () => {
  it('matches spellings of one school but never two blank schools', () => {
    expect(isSameSchool('Newtons TKD', "newton's tkd")).toBe(true);
    expect(isSameSchool('Newtons TKD', 'Newtons TKD (Markham)')).toBe(false);
    expect(
      isSameSchool('Newtons TKD', 'Newtons TKD (Markham)', createSchoolResolver([{ alias: 'Newtons TKD (Markham)', school: 'Newtons TKD' }])),
    ).toBe(true);
    expect(isSameSchool(null, '')).toBe(false);
  });
});

describe('dominantSchool', () => {
  it('reports the biggest school when it reaches the share', () => {
    expect(dominantSchool(['Newtons TKD', 'newtons tkd', 'Other', null], 0.5)).toEqual({
      label: 'Newtons TKD',
      count: 2,
      total: 4,
    });
    expect(dominantSchool(['Newtons TKD', 'newtons tkd', 'Other', null], 0.6)).toBeNull();
  });

  it('does not count blank schools as a school', () => {
    expect(dominantSchool([null, '', null], 0.1)).toBeNull();
  });
});

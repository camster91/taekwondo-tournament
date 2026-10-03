import { describe, it, expect } from 'vitest';
import {
  ageBandLabel,
  beltRangeLabel,
  classicFolderName,
  classicHeaderTitle,
  classicZipPath,
  fitTextToWidth,
  genderPlural,
  ordinal,
  safeFileName,
} from './classic-paper';

const base = {
  name: '10-11 CB-All Blue/Red Belts Females Sparring Heavy',
  beltLevel: 'CB',
  gender: 'F',
  ageMin: 10,
  ageMax: 11,
  weightClass: 'Heavy',
  beltColors: '["Blue","Red"]',
};

describe('classic paper naming', () => {
  it('names folders like the old event', () => {
    expect(classicFolderName('CB', 'F', 'Sparring')).toBe('CB Females Sparring');
    expect(classicFolderName('BB', 'M', 'Patterns')).toBe('BB Males Patterns');
    expect(classicFolderName('CB', 'X', 'Kata')).toBe('CB Mixed Kata');
  });

  it('uses the sport event label, not a hardcoded one', () => {
    expect(classicFolderName('CB', 'M', 'Kumite')).toBe('CB Males Kumite');
    expect(classicHeaderTitle({ ...base, gender: 'M' }, 'Kumite')).toBe('KUMITE Males 10 - 11 Heavy');
  });

  it('writes the header like the old sheets', () => {
    expect(classicHeaderTitle(base, 'Sparring')).toBe('SPARRING Females 10 - 11 Heavy');
    expect(classicHeaderTitle({ ...base, weightClass: null, ageMin: 36, ageMax: 99 }, 'Patterns')).toBe('PATTERNS Females 36 Plus');
  });

  it('labels age bands', () => {
    expect(ageBandLabel(10, 11)).toBe('10 - 11');
    expect(ageBandLabel(36, 99)).toBe('36 Plus');
    expect(ageBandLabel(0, 11)).toBe('11 and Under');
    expect(ageBandLabel(7, 7)).toBe('7');
  });

  it('makes file names safe and keeps "/" readable as "_"', () => {
    expect(safeFileName('10-11 CB-All Blue/Red Belts')).toBe('10-11 CB-All Blue_Red Belts');
    expect(safeFileName('a:b*c?"d<e>f|g')).toBe('abcdefg');
    expect(safeFileName('  trailing dot. ')).toBe('trailing dot');
    expect(safeFileName('???')).toBe('Division');
    expect(safeFileName('x'.repeat(300))).toHaveLength(120);
  });

  it('puts each sheet in its folder and de-duplicates names', () => {
    const taken = new Set<string>();
    expect(classicZipPath(base, 'Sparring', taken)).toBe('CB Females Sparring/10-11 CB-All Blue_Red Belts Females Sparring Heavy.pdf');
    expect(classicZipPath(base, 'Sparring', taken)).toBe('CB Females Sparring/10-11 CB-All Blue_Red Belts Females Sparring Heavy (2).pdf');
    expect(classicZipPath({ ...base, name: base.name.toUpperCase() }, 'Sparring', taken)).toMatch(/\(3\)\.pdf$/);
  });

  it('describes the belt or dan range for the footer', () => {
    expect(beltRangeLabel(base)).toBe('Colour belts: Blue and Red');
    expect(beltRangeLabel({ ...base, beltColors: '["White","Yellow","Green"]' })).toBe('Colour belts: White to Green');
    expect(beltRangeLabel({ ...base, beltColors: '["Yellow"]' })).toBe('Colour belts: Yellow');
    expect(beltRangeLabel({ ...base, beltColors: 'broken' })).toBe('Colour belts');
    expect(beltRangeLabel({ ...base, beltLevel: 'BB', danMin: 1, danMax: 2 })).toBe('Black belts: 1st - 2nd Dan');
    expect(beltRangeLabel({ ...base, beltLevel: 'BB', danMin: 3, danMax: 3 })).toBe('Black belts: 3rd Dan');
    expect(beltRangeLabel({ ...base, beltLevel: 'BB' })).toBe('Black belts');
  });

  it('spells ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    expect(genderPlural('F')).toBe('Females');
  });
});

describe('fitTextToWidth', () => {
  // Fake font: every character is 0.5em wide.
  const measure = (text: string, size: number) => text.length * size * 0.5;

  it('keeps the full size when the text fits', () => {
    expect(fitTextToWidth('Jo Lee', 100, measure, 8)).toEqual({ text: 'Jo Lee', fontSize: 8, truncated: false });
  });

  it('shrinks a long name instead of cutting it', () => {
    const name = 'Alexandra Montgomery-Fitzgerald'; // 31 chars: 124 wide at 8pt
    const fitted = fitTextToWidth(name, 100, measure, 8);
    expect(fitted.text).toBe(name);
    expect(fitted.truncated).toBe(false);
    expect(fitted.fontSize).toBeLessThan(8);
    expect(fitted.fontSize).toBeGreaterThanOrEqual(6);
    expect(measure(fitted.text, fitted.fontSize)).toBeLessThanOrEqual(100);
  });

  it('cuts with "…" only when it still does not fit at the minimum size', () => {
    const name = 'A'.repeat(60); // 180 wide at 6pt
    const fitted = fitTextToWidth(name, 60, measure, 8, 6);
    expect(fitted.fontSize).toBe(6);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.endsWith('…')).toBe(true);
    expect(measure(fitted.text, 6)).toBeLessThanOrEqual(60);
  });

  it('honours a custom minimum', () => {
    expect(fitTextToWidth('A'.repeat(30), 100, measure, 9, 7).fontSize).toBe(7);
  });
});

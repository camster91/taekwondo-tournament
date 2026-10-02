import { describe, expect, it } from 'vitest';
import { whiteTextContrast } from './OrgBrandingForm';

describe('whiteTextContrast', () => {
  it('rates dark colours readable and light ones not', () => {
    expect(whiteTextContrast('#000000')).toBeCloseTo(21, 0);
    expect(whiteTextContrast('#1D4ED8')).toBeGreaterThan(4.5);
    expect(whiteTextContrast('#FFFF00')).toBeLessThan(2);
  });
});

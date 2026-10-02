import { describe, expect, it } from 'vitest';
import { isValidScore, parseScore } from './score';

describe('score format', () => {
  it('accepts whole numbers and up to two decimal places', () => {
    for (const v of ['0', '7', '999', '8.7', '8.75', '0.5', '10.0']) expect(isValidScore(v)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of ['', '-1', '1000', '8.755', '.5', '8.', ' 8', '1e2', 'abc', '<b>']) expect(isValidScore(v)).toBe(false);
  });

  it('parses valid scores and returns null otherwise', () => {
    expect(parseScore('8.75')).toBe(8.75);
    expect(parseScore('12')).toBe(12);
    expect(parseScore('x')).toBeNull();
    expect(parseScore(null)).toBeNull();
  });
});

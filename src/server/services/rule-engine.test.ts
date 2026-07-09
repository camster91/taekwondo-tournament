import { describe, it, expect } from 'vitest';
import { computeFairnessScore } from './rule-engine.js';

describe('computeFairnessScore', () => {
  it('returns 100 when there are no violations or warnings', () => {
    expect(computeFairnessScore({ violations: 0, warnings: 0 })).toBe(100);
  });

  it('subtracts 5 points per hard violation', () => {
    expect(computeFairnessScore({ violations: 1, warnings: 0 })).toBe(95);
    expect(computeFairnessScore({ violations: 2, warnings: 0 })).toBe(90);
    expect(computeFairnessScore({ violations: 10, warnings: 0 })).toBe(50);
  });

  it('subtracts 2 points per soft warning', () => {
    expect(computeFairnessScore({ violations: 0, warnings: 1 })).toBe(98);
    expect(computeFairnessScore({ violations: 0, warnings: 5 })).toBe(90);
  });

  it('combines hard and soft penalties additively', () => {
    // 2 hard violations + 3 soft warnings = 10 + 6 = 16, 100 - 16 = 84
    expect(computeFairnessScore({ violations: 2, warnings: 3 })).toBe(84);
  });

  it('floors at 0 for extreme violation counts', () => {
    expect(computeFairnessScore({ violations: 100, warnings: 0 })).toBe(0);
    expect(computeFairnessScore({ violations: 50, warnings: 50 })).toBe(0);
  });

  it('rounds to the nearest integer', () => {
    // 1 violation at penalty 5 + 1 warning at penalty 2 = 7 points off → 93
    expect(computeFairnessScore({ violations: 1, warnings: 1 })).toBe(93);
  });

  it('regression: previous formula returned 100 for typical small-tournament violation counts', () => {
    // For a 100-match × 5-rule tournament with 2 hard violations:
    // OLD: 100 - (2 / 500) * 100 = 99.6 → rounds to 100 (bad signal)
    // NEW: 100 - 5 * 2 = 90 (real signal)
    expect(computeFairnessScore({ violations: 2, warnings: 0 })).not.toBe(100);
    expect(computeFairnessScore({ violations: 2, warnings: 0 })).toBe(90);
  });
});

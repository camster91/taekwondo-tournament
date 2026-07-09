import { describe, it, expect } from 'vitest';
import { computeFairnessScore, loadTournamentRules } from './rule-engine.js';

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

describe('loadTournamentRules enforcement coercion', () => {
  // Helper that builds a fake Prisma client returning a single row with
  // the given raw enforcement value. Lets us test coerceEnforcement in
  // isolation without booting the real Prisma adapter.
  function fakePrismaWithEnforcement(raw: string) {
    return {
      tournamentRule: {
        findMany: async () => [
          {
            id: 'rule-1',
            tournamentId: 't-1',
            name: 'Test rule',
            description: null,
            category: 'bracket',
            ruleType: 'weight_tolerance',
            enforcement: raw,
            parameters: JSON.stringify({ maxDifferenceLbs: 10, ageGroupOverrides: {} }),
            priority: 50,
            isActive: true,
            source: 'manual',
          },
        ],
      },
    } as unknown as Parameters<typeof loadTournamentRules>[0];
  }

  it('passes through canonical values unchanged', async () => {
    for (const v of ['hard', 'soft', 'info'] as const) {
      const rules = await loadTournamentRules(fakePrismaWithEnforcement(v), 't-1');
      expect(rules[0].enforcement).toBe(v);
    }
  });

  it('coerces unknown values to info and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = await loadTournamentRules(fakePrismaWithEnforcement('HARD'), 't-1');
    expect(rules[0].enforcement).toBe('info');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized enforcement "HARD"')
    );
    warn.mockRestore();
  });

  it('coerces empty string to info', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = await loadTournamentRules(fakePrismaWithEnforcement(''), 't-1');
    expect(rules[0].enforcement).toBe('info');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

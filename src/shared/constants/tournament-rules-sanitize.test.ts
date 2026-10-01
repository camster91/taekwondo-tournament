import { describe, expect, it } from 'vitest';
import { DEFAULT_DIVISION_RULES, parseTournamentRules } from './tournament-rules';

describe('parseTournamentRules division sizes', () => {
  const sizes = (divisions: Record<string, unknown>) =>
    parseTournamentRules(JSON.stringify({ divisions })).divisions;

  it('clamps stored sizes to the editor ranges', () => {
    expect(sizes({ maxDivisionSize: 0, minDivisionSize: -3 })).toMatchObject({ maxDivisionSize: 4, minDivisionSize: 1 });
    expect(sizes({ maxDivisionSize: 500, minDivisionSize: 50 })).toMatchObject({ maxDivisionSize: 64, minDivisionSize: 10 });
    expect(sizes({ maxDivisionSize: 12.6 })).toMatchObject({ maxDivisionSize: 13 });
  });

  it('falls back to defaults for non-numeric sizes', () => {
    expect(sizes({ maxDivisionSize: 'x', minDivisionSize: null })).toMatchObject({
      maxDivisionSize: DEFAULT_DIVISION_RULES.maxDivisionSize,
      minDivisionSize: DEFAULT_DIVISION_RULES.minDivisionSize,
    });
  });
});

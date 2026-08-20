import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOURNAMENT_RULES,
  parseTournamentRules,
  type TournamentRules,
} from '../../shared/constants/tournament-rules';

describe('Tournament Settings & Rules state integrity', () => {
  it('parses empty or missing settings into clean default rules', () => {
    expect(parseTournamentRules(null)).toEqual(DEFAULT_TOURNAMENT_RULES);
    expect(parseTournamentRules(undefined)).toEqual(DEFAULT_TOURNAMENT_RULES);
    expect(parseTournamentRules('')).toEqual(DEFAULT_TOURNAMENT_RULES);
    expect(parseTournamentRules('{}')).toEqual(DEFAULT_TOURNAMENT_RULES);
  });

  it('correctly reads persisted rules from tournament settings json', () => {
    const customRules: TournamentRules = {
      ...DEFAULT_TOURNAMENT_RULES,
      divisions: {
        ...DEFAULT_TOURNAMENT_RULES.divisions,
        minDivisionSize: 4,
        maxDivisionSize: 16,
      },
    };

    const json = JSON.stringify({ rules: customRules });
    const parsed = parseTournamentRules(json);
    expect(parsed.divisions.minDivisionSize).toBe(4);
    expect(parsed.divisions.maxDivisionSize).toBe(16);
  });
});

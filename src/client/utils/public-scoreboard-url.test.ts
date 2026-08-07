import { describe, expect, it } from 'vitest';
import {
  buildResolvedScoreboardPath,
  buildScoreboardApiUrl,
} from './public-scoreboard-url.js';

describe('public scoreboard URL security', () => {
  it('preserves the current share key when resolving a slug to a display route', () => {
    expect(buildResolvedScoreboardPath('tournament-1', 'new/key')).toBe(
      '/display/tournament-1?key=new%2Fkey'
    );
  });

  it('includes the current share key in unauthenticated scoreboard API requests', () => {
    expect(buildScoreboardApiUrl('tournament-1', 'new/key')).toBe(
      '/api/public/tournaments/tournament-1/scoreboard?key=new%2Fkey'
    );
  });

  it('keeps authenticated staff URLs valid when no public key is present', () => {
    expect(buildScoreboardApiUrl('tournament-1', null)).toBe(
      '/api/public/tournaments/tournament-1/scoreboard'
    );
  });
});

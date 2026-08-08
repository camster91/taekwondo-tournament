import { describe, expect, it } from 'vitest';
import { getScoreboardUnavailableMessage } from './scoreboard-availability';

describe('scoreboard availability', () => {
  it('returns an explicit public-facing message for a failed scoreboard request', () => {
    expect(getScoreboardUnavailableMessage(new Error('Scoreboard fetch failed'))).toBe(
      'Live match data is unavailable right now. Please try again shortly.',
    );
  });

  it('returns no message when the scoreboard request succeeded', () => {
    expect(getScoreboardUnavailableMessage(null)).toBeNull();
  });
});

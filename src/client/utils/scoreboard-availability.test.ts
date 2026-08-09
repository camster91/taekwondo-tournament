import { describe, expect, it } from 'vitest';
import { getScoreboardUnavailableMessage } from './scoreboard-availability';
import { ApiFailure } from './api-status';

describe('scoreboard availability', () => {
  it('returns an explicit public-facing message for a failed scoreboard request', () => {
    expect(getScoreboardUnavailableMessage(new Error('Scoreboard fetch failed'))).toBe(
      'Live match data is unavailable right now. Please try again shortly.',
    );
  });

  it('returns no message when the scoreboard request succeeded', () => {
    expect(getScoreboardUnavailableMessage(null)).toBeNull();
  });

  it('distinguishes inactive links and rate limits from outages', () => {
    expect(getScoreboardUnavailableMessage(new ApiFailure('Not found', 'not_found', false, 404))).toContain('link is inactive');
    expect(getScoreboardUnavailableMessage(new ApiFailure('Busy', 'rate_limited', true, 429, 42))).toContain('42 seconds');
  });
});

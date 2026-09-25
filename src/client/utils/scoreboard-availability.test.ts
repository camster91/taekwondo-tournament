import { describe, expect, it } from 'vitest';
import {
  getScoreboardState,
  getScoreboardUnavailableMessage,
  getStaleBannerMessage,
  SCOREBOARD_POLL_INTERVAL_MS,
  STALE_AFTER_SECONDS,
} from './scoreboard-availability';
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

describe('getScoreboardState', () => {
  const base = {
    tournamentError: null,
    tournamentLoading: false,
    hasData: false,
    divisionsLoading: false,
    hasError: false,
    staleSeconds: null,
    staleAfterSeconds: STALE_AFTER_SECONDS,
  };

  it('returns unavailable (full-screen) when the tournament query itself failed', () => {
    const s = getScoreboardState({ ...base, tournamentError: new Error('not found') });
    expect(s.status).toBe('unavailable');
    expect(s.showMainBoard).toBe(false);
    expect(s.showFullScreenError).toBe(true);
    expect(s.showStaleBanner).toBe(false);
    expect(s.announcement).toBe('Tournament not found');
  });

  it('keeps the cached board with a stale banner when a metadata poll fails transiently', () => {
    const s = getScoreboardState({ ...base, hasTournament: true, hasData: true, tournamentError: new Error('HTTP 500') });
    expect(s.status).toBe('stale');
    expect(s.showMainBoard).toBe(true);
    expect(s.showStaleBanner).toBe(true);
    expect(s.showFullScreenError).toBe(false);
  });

  it('returns loading when no data is present and the scoreboard query is in flight', () => {
    const s = getScoreboardState({ ...base, tournamentLoading: true });
    expect(s.status).toBe('loading');
    expect(s.showMainBoard).toBe(false);
    expect(s.showFullScreenError).toBe(false);
  });

  it('returns loading when divisions are still in flight (e.g. first paint after tournament load)', () => {
    const s = getScoreboardState({ ...base, divisionsLoading: true });
    expect(s.status).toBe('loading');
    expect(s.showMainBoard).toBe(false);
  });

  it('returns unavailable (full-screen) when there was no data and the scoreboard errored on the first attempt', () => {
    const s = getScoreboardState({ ...base, hasError: true });
    expect(s.status).toBe('unavailable');
    expect(s.showMainBoard).toBe(false);
    expect(s.showFullScreenError).toBe(true);
    expect(s.showStaleBanner).toBe(false);
    expect(s.announcement).toBe('Live scoreboard unavailable');
  });

  it('returns stale (with main board) when we have data but the latest refetch errored', () => {
    const s = getScoreboardState({ ...base, hasData: true, hasError: true });
    expect(s.status).toBe('stale');
    expect(s.showMainBoard).toBe(true);
    expect(s.showFullScreenError).toBe(false);
    expect(s.showStaleBanner).toBe(true);
    expect(s.announcement).toBe('Showing last known scoreboard data');
  });

  it('returns stale (with main board) when the last successful fetch is older than the threshold', () => {
    const s = getScoreboardState({
      ...base,
      hasData: true,
      staleSeconds: STALE_AFTER_SECONDS + 1,
    });
    expect(s.status).toBe('stale');
    expect(s.showMainBoard).toBe(true);
    expect(s.showStaleBanner).toBe(true);
  });

  it('returns live (with main board, no banner) when we have recent data and no error', () => {
    const s = getScoreboardState({ ...base, hasData: true, staleSeconds: 5 });
    expect(s.status).toBe('live');
    expect(s.showMainBoard).toBe(true);
    expect(s.showStaleBanner).toBe(false);
    expect(s.announcement).toBe('Scoreboard is live');
  });

  it('returns live at the boundary (staleSeconds === threshold)', () => {
    const s = getScoreboardState({
      ...base,
      hasData: true,
      staleSeconds: STALE_AFTER_SECONDS,
    });
    expect(s.status).toBe('live');
  });

  it('prefers error-state over time-based stale when both apply', () => {
    // The error-state announcement is more actionable for the user
    // than the seconds counter. Error wins.
    const s = getScoreboardState({
      ...base,
      hasData: true,
      hasError: true,
      staleSeconds: 999,
    });
    expect(s.status).toBe('stale');
    expect(s.announcement).toBe('Showing last known scoreboard data');
  });
});

describe('getStaleBannerMessage', () => {
  it('uses the error-specific copy when the latest fetch errored', () => {
    expect(getStaleBannerMessage(true, 30).headline).toBe(
      'Live feed unavailable — showing last known data',
    );
  });

  it('includes the seconds counter when only the time threshold tripped', () => {
    expect(getStaleBannerMessage(false, 30).headline).toBe('Scoreboard data is stale');
    expect(getStaleBannerMessage(false, 30).detail).toContain('30');
  });

  it('returns a stable headline regardless of seconds when no error and no seconds', () => {
    expect(getStaleBannerMessage(false, null).headline).toBe('Scoreboard data is stale');
  });
});

describe('knobs', () => {
  it('keeps the poll interval and the stale threshold exported as one source of truth', () => {
    // The component derives both the polling cadence and the
    // "auto-refresh every N seconds" copy from these. A change
    // here should be intentional.
    expect(SCOREBOARD_POLL_INTERVAL_MS).toBe(5000);
    expect(STALE_AFTER_SECONDS).toBe(15);
  });
});

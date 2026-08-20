/**
 * Public-scoreboard availability / freshness state.
 *
 * The scoreboard polls the server every few seconds and renders
 * the last successful response on a TV at the venue. Three failure
 * modes have to render differently:
 *
 *   1. The tournament query itself failed (404 / 400). The whole
 *      board is wrong; show a full-screen "tournament not found"
 *      message and never render the data view.
 *   2. The scoreboard query failed BEFORE we ever got data
 *      (initial failure, e.g. backend down at venue open).
 *      Same full-screen "unavailable" treatment.
 *   3. The scoreboard query failed AFTER we already had data
 *      (transient network blip, server restart). Show the last
 *      good data with an explicit stale indicator so the
 *      director knows what they're looking at is no longer
 *      live — but don't blank the board and make the venue
 *      look like the system is down.
 *
 * This module owns the *decision* about which mode we're in.
 * PublicScoreboard.tsx owns the *render* of each mode.
 *
 * The `announcement` field is the short, screen-reader-friendly
 * string that goes into the `aria-live` region. The component
 * keeps that string in a separate element from the per-second
 * "stale for N seconds" detail so the live region only fires
 * on state transitions, not on every tick of the clock.
 */

export type ScoreboardStatus = 'loading' | 'live' | 'stale' | 'unavailable';

export interface ScoreboardState {
  status: ScoreboardStatus;
  /**
   * Short, screen-reader-friendly label for the live region. Stays
   * stable across re-renders so the AT only announces on
   * state changes, not on every poll tick.
   */
  announcement: string;
  /** True if the main board should render (we have data, even if stale). */
  showMainBoard: boolean;
  /** True if a full-screen "unavailable" message should render. */
  showFullScreenError: boolean;
  /** True if the inline stale banner should render inside the main board. */
  showStaleBanner: boolean;
}

export interface ScoreboardStateInput {
  tournamentError: unknown;
  tournamentLoading: boolean;
  /** True when divisions data is present (last successful fetch). */
  hasData: boolean;
  divisionsLoading: boolean;
  /** True when the scoreboard query has a current error. */
  hasError: boolean;
  /** Seconds since the last successful scoreboard fetch, or null. */
  staleSeconds: number | null;
  /** Threshold (seconds) at which "no recent data" becomes "stale". */
  staleAfterSeconds: number;
}

export function getScoreboardState(input: ScoreboardStateInput): ScoreboardState {
  if (input.tournamentError) {
    return {
      status: 'unavailable',
      announcement: 'Tournament not found',
      showMainBoard: false,
      showFullScreenError: true,
      showStaleBanner: false,
    };
  }
  // Initial loading — tournament loaded, scoreboard not yet.
  if (!input.hasData && (input.tournamentLoading || input.divisionsLoading)) {
    return {
      status: 'loading',
      announcement: 'Loading scoreboard',
      showMainBoard: false,
      showFullScreenError: false,
      showStaleBanner: false,
    };
  }
  // Initial failure — no data and the scoreboard query errored.
  if (!input.hasData && input.hasError) {
    return {
      status: 'unavailable',
      announcement: 'Live scoreboard unavailable',
      showMainBoard: false,
      showFullScreenError: true,
      showStaleBanner: false,
    };
  }
  // We have data. The board is either live, stale-by-time, or
  // stale-by-error (in priority order).
  if (input.hasError) {
    return {
      status: 'stale',
      announcement: 'Showing last known scoreboard data',
      showMainBoard: true,
      showFullScreenError: false,
      showStaleBanner: true,
    };
  }
  if (
    input.staleSeconds != null &&
    input.staleSeconds > input.staleAfterSeconds
  ) {
    return {
      status: 'stale',
      announcement: 'Scoreboard data is stale',
      showMainBoard: true,
      showFullScreenError: false,
      showStaleBanner: true,
    };
  }
  return {
    status: 'live',
    announcement: 'Scoreboard is live',
    showMainBoard: true,
    showFullScreenError: false,
    showStaleBanner: false,
  };
}

/**
 * Public-facing message for a full-screen "live scoreboard
 * unavailable" error. The old API: takes an error and returns
 * either a sentence or null. Kept for backwards compatibility
 * with the existing test, but the component now uses
 * `getScoreboardState` for the conditional + `getScoreboardFullScreenMessage`
 * for the text.
 */
export function getScoreboardUnavailableMessage(error: unknown): string | null {
  return error
    ? 'Live match data is unavailable right now. Please try again shortly.'
    : null;
}

/**
 * Suggested copy for the inline stale banner. Kept stable so
 * the aria-live region doesn't re-announce on every poll tick.
 */
export function getStaleBannerMessage(
  hasError: boolean,
  staleSeconds: number | null,
): { headline: string; detail: string } {
  if (hasError) {
    return {
      headline: 'Live feed unavailable — showing last known data',
      detail: 'Check the venue network. The display will recover automatically when the feed comes back.',
    };
  }
  if (staleSeconds != null) {
    return {
      headline: 'Scoreboard data is stale',
      detail: `No update for ${staleSeconds} seconds. Check the venue Wi-Fi or the server.`,
    };
  }
  return {
    headline: 'Scoreboard data is stale',
    detail: 'Check the venue Wi-Fi or the server.',
  };
}

/**
 * Polling and freshness knobs in one place. The component uses
 * the same numbers to drive the cadence (refetchInterval) and
 * the displayed copy ("auto-refresh every N seconds"), so the
 * two can't drift.
 */
export const SCOREBOARD_POLL_INTERVAL_MS = 5000;
export const STALE_AFTER_SECONDS = 15;

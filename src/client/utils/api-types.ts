/**
 * Shared response shapes for the dashboard / detail page API calls.
 *
 * **Single source of truth lives in `src/shared/contracts/`.** The Zod
 * schemas there are validated by the server-side contract tests; this
 * file just re-exports the inferred types so the client cannot drift
 * from the wire format.
 *
 * If you need a wider shape (a field the server includes but the page
 * doesn't), prefer adding it to the contract schema first and letting
 * the type flow through here — that way the field is typed *and* locked
 * by a contract test.
 *
 * Historical note: before issue #130, this file hand-mirrored Prisma
 * include shapes, which produced the #26/#31/#38/#42, #32/#36/#44, and
 * #41 shape-drift clusters. The re-exports below fix that for the two
 * highest-traffic endpoints (public scoreboard, tournament detail
 * divisions) and lay the foundation for rolling the same pattern to
 * the remaining endpoints — see `docs/contracts.md`.
 */

import type {
  BracketType,
  DivisionMatch,
  DivisionWithMatches,
  DivisionWithMatchesResponse,
  EnrichedDivisionMatch,
  MatchStatus,
  PublicBracket,
  PublicMatch,
  PublicMatchCompetitor,
  PublicScoreboardDivision,
  PublicScoreboardResponse,
} from '@shared/contracts';

export type {
  BracketType,
  DivisionMatch,
  DivisionWithMatches,
  DivisionWithMatchesResponse,
  EnrichedDivisionMatch,
  MatchStatus,
  PublicBracket,
  PublicMatch,
  PublicMatchCompetitor,
  PublicScoreboardDivision,
  PublicScoreboardResponse,
};

// ---------------------------------------------------------------------------
// Legacy types — kept as thin re-exports so existing imports keep working.
// New code should import directly from `@shared/contracts` or from the
// re-exports above.
// ---------------------------------------------------------------------------

/** A match competitor slot — populated by scorekeeper PATCH or null when TBD. */
export type MatchCompetitorSlot = PublicMatchCompetitor;

/** A bracket match as returned by /api/divisions/tournament/:id?withMatches=true. */
export type ApiMatch = EnrichedDivisionMatch;

/** A bracket as embedded in the division response. */
export type ApiBracket = PublicBracket;

/** A division as returned by the tournament-divisions endpoint. */
export type ApiDivision = DivisionWithMatches;

/**
 * Minimal tournament shape used by dashboards. The full tournament
 * response has many more fields (organizationId, settings JSON string,
 * etc.); pages that need them should declare a wider local type.
 *
 * Not yet covered by a Zod contract — see `docs/contracts.md` for the
 * staged rollout.
 */
export interface ApiTournamentSummary {
  id: string;
  name: string;
  status: string;
  date: string;
  settings?: string | null;
  /**
   * Present when the server includes `_count` on the tournament
   * fetch (registration + division counts). Optional because not
   * every endpoint includes it.
   */
  _count?: { registrations?: number; divisions?: number };
}

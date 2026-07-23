/**
 * Pure helpers that build the Prisma `where` predicates used by the
 * GET /api/analytics/dashboard handler.
 *
 * Background: PR #113 / Phase 18 audit. The original handler had a
 * direct `prisma.match.count()` with no `where` clause, so a user in
 * org A could see `totalMatches` from tournaments they had no access to
 * — and even worse, counts that looked correct on the dashboard were
 * wrong for every role below `admin`. The fix scopes every count to
 * the user's tournament-access filter AND the soft-delete filter.
 *
 * Kept as a pure module (no Prisma client, no auth calls) so the
 * predicate construction is unit-testable in isolation. The handler
 * still does the I/O — this module just answers "given an access
 * filter and the notDeleted marker, what `where` should each model
 * use?".
 */
import type { Prisma } from '@prisma/client';

/**
 * The soft-delete marker every dashboard count must apply. We accept
 * it as a parameter (rather than hard-coding) so unit tests can prove
 * the marker is always present — the historical bug was that the
 * match count dropped `notDeleted` entirely.
 */
export type NotDeleted = { deletedAt: null };

/**
 * The access filter shape returned by `buildTournamentAccessFilter`.
 * `null` means "sees everything" (admin or legacy single-tenant user).
 */
export type TournamentAccessFilter = Prisma.TournamentWhereInput | null;

/**
 * Combine the access filter with the soft-delete marker for queries
 * that target the `Tournament` model directly. `null` access filter
 * still gets the `notDeleted` clause so trash rows never leak.
 */
export function tournamentWhere(
  tournamentFilter: TournamentAccessFilter,
  notDeleted: NotDeleted
): Prisma.TournamentWhereInput {
  return tournamentFilter
    ? { AND: [tournamentFilter, notDeleted] }
    : notDeleted;
}

/**
 * Registration belongs directly to Tournament, so the filter is the
 * same shape as `tournamentWhere` — but routed through the relation
 * field. Exposed separately so the route reads cleanly.
 */
export function registrationWhere(
  tournamentFilter: TournamentAccessFilter,
  notDeleted: NotDeleted
): Prisma.RegistrationWhereInput {
  return {
    tournament: tournamentWhere(tournamentFilter, notDeleted),
  };
}

/**
 * Competitor has no `tournamentId` — it's connected via
 * `Registration[]`. The "competitor is in a tournament the user can
 * see, not soft-deleted" predicate is `registrations: { some: ... }`.
 *
 * Note: this is a heavier shape than a direct `notDeleted` count —
 * it walks a 1-to-many relation. Acceptable for the dashboard (low
 * QPS) and the alternative — exposing competitors from inaccessible
 * tournaments — is the security defect we're closing.
 */
export function competitorWhere(
  tournamentFilter: TournamentAccessFilter,
  notDeleted: NotDeleted
): Prisma.CompetitorWhereInput {
  const tournamentClause = tournamentFilter
    ? { AND: [tournamentFilter, notDeleted] }
    : notDeleted;
  return {
    AND: [notDeleted, { registrations: { some: { tournament: tournamentClause } } }],
  };
}

/**
 * Match has no `tournamentId` and no `deletedAt`. The path to scope
 * it to the user's access is `bracket → division → tournament`.
 * We always apply `notDeleted` on the tournament (no leaked trash
 * matches) and additionally scope by the access filter when present.
 */
export function matchWhere(
  tournamentFilter: TournamentAccessFilter,
  notDeleted: NotDeleted
): Prisma.MatchWhereInput {
  const tournamentClause = tournamentFilter
    ? { AND: [tournamentFilter, notDeleted] }
    : notDeleted;
  return {
    bracket: {
      division: {
        tournament: tournamentClause,
      },
    },
  };
}

/**
 * Build every `where` clause the dashboard handler needs in one call.
 * Exposes the same shape so the handler can `Object.assign` extras
 * (e.g. `createdAt: { gte: ... }` for recent registrations) onto the
 * relevant model without losing the scoping.
 */
export interface DashboardWhereClauses {
  tournament: Prisma.TournamentWhereInput;
  competitor: Prisma.CompetitorWhereInput;
  match: Prisma.MatchWhereInput;
  registration: Prisma.RegistrationWhereInput;
}

export function buildDashboardWhereClauses(
  tournamentFilter: TournamentAccessFilter,
  notDeleted: NotDeleted
): DashboardWhereClauses {
  return {
    tournament: tournamentWhere(tournamentFilter, notDeleted),
    competitor: competitorWhere(tournamentFilter, notDeleted),
    match: matchWhere(tournamentFilter, notDeleted),
    registration: registrationWhere(tournamentFilter, notDeleted),
  };
}

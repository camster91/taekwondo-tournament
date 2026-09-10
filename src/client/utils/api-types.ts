/**
 * @deprecated This file is being migrated to `src/shared/contracts/`.
 * 
 * Shared response shapes for the dashboard / detail page API calls.
 *
 * These mirror the server-side include shape used in `routes/divisions.ts`
 * and `routes/brackets.ts`. Keeping them in one place stops each page from
 * declaring its own ad-hoc `any[]` shape and lets the same types flow
 * through hooks, derived selectors, and components.
 *
 * **Migration plan**:
 * - Phase 1 (current): Shared contracts in `src/shared/contracts/` with test coverage
 * - Phase 2 (next): Migrate remaining pages to use `@/shared/contracts`
 * - Phase 3: Delete this file after all consumers migrated
 * 
 * **New consumers**: Import from `../../shared/contracts` instead of this file.
 * 
 * Only the fields the dashboards actually consume are typed; the server
 * returns more (registration, audit log, etc.) but pages that don't
 * need them should not pretend they do.
 */

export type MatchStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'bye';

/** A match competitor slot — populated by scorekeeper PATCH or null when TBD. */
export interface MatchCompetitorSlot {
  id: string;
  competitor: {
    firstName: string;
    lastName: string;
    schoolDojang?: string | null;
  };
}

/** A bracket match as returned by /api/divisions/tournament/:id?withMatches=true. */
export interface ApiMatch {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: 'winners' | 'losers' | 'finals';
  status: MatchStatus;
  ringNumber?: number | null;
  competitor1?: MatchCompetitorSlot | null;
  competitor2?: MatchCompetitorSlot | null;
  winner?: MatchCompetitorSlot | null;
  score1?: string | null;
  score2?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  videoUrl?: string | null;
  /** Internal helper used by DirectorDashboard after flatMap. Not server-side. */
  _divisionId?: string;
  _divisionName?: string;
}

/** A bracket as embedded in the division response. */
export interface ApiBracket {
  id: string;
  format?: string | null;
  matches: ApiMatch[];
}

/** A division as returned by the tournament-divisions endpoint. */
export interface ApiDivision {
  id: string;
  name: string;
  eventType: string;
  beltLevel?: string | null;
  gender?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  weightClass?: string | null;
  bracket: ApiBracket | null;
}

/**
 * Minimal tournament shape used by dashboards. The full tournament
 * response has many more fields (organizationId, settings JSON string,
 * etc.); pages that need them should declare a wider local type.
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

/**
 * @deprecated DEPRECATED — This file is superseded by `src/shared/contracts/`.
 * 
 * **DO NOT USE** for new code. Import from `@/shared/contracts` instead.
 * 
 * **Migration status (Phase 2 complete)**:
 * - ✅ DirectorDashboard.tsx → migrated to `@/shared/contracts`
 * - ✅ Scorekeeper.tsx → migrated to `@/shared/contracts`
 * - ✅ Divisions.tsx → migrated to `@/shared/contracts`
 * - ✅ BracketEditor.tsx → migrated to `@/shared/contracts`
 * - ✅ Results.tsx → uses local DivisionLike (specialized shape for CSV export)
 * 
 * This file is retained for **rollback safety only**. It will be deleted in Phase 3
 * after runtime validation proves the migration is stable.
 * 
 * **Phase 3 blockers**: Performance benchmarking of Zod `.parse()` on hot paths
 * (scorekeeper, public scoreboard) — if p99 latency increases >5ms, contracts
 * remain types-only and skip runtime validation.
 */

// Match shapes are derived from the shared zod contract so this deprecated
// module can't drift from what the server returns.
export type { MatchStatus, MatchCompetitorSlot, ApiMatch } from '../../shared/contracts';
import type { ApiMatch } from '../../shared/contracts';

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

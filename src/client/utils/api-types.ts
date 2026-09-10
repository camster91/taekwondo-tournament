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

/**
 * Parsed `Match.scores` JSON payload. The DB stores `scores` as a JSON
 * string; this is the shape that lives inside it for completed
 * matches. The struct may also carry `bye: true` (round advance
 * from a single-competitor bracket) or `manualOverride` /
 * `overrideReason` (the legacy `notes` override moved here in SH-4).
 */
export interface ApiMatchScoreObject {
  score1?: string;
  score2?: string;
  bye?: boolean;
  manualOverride?: boolean;
  overrideReason?: string;
}

/** Parsed helper that JSON.parses the raw `scores` field if present. */
export function parseMatchScores(raw: string | null | undefined): ApiMatchScoreObject | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as ApiMatchScoreObject;
    }
  } catch {
    // fall through
  }
  return null;
}

/** A bracket match as returned by /api/divisions/tournament/:id?withMatches=true. */
export interface ApiMatch {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: 'winners' | 'losers' | 'finals';
  status: MatchStatus;
  // SH-4: schema renamed `ringNumber` (Int) to `ring` (String,
  // e.g. "A", "B", "1", "2") and `score1`/`score2` columns were
  // collapsed into a single `scores` JSON string. The helper
  // `parseMatchScores` above extracts the per-competitor values.
  ring?: string | null;
  scores?: string | null;
  competitor1?: MatchCompetitorSlot | null;
  competitor2?: MatchCompetitorSlot | null;
  winner?: MatchCompetitorSlot | null;
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

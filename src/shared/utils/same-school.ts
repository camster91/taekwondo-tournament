// Same-school ("team-mates") first-round fights.
//
// The old spreadsheet macro counted how many first-round bouts paired two
// competitors from the same school; directors use that number to judge a
// draw. Shared by the server (bracket API responses) and the client
// (Divisions page, bracket editor) so both count the same way.

import { normalizeSchoolName } from './school.js';

/**
 * School name used for comparisons (the app-wide `normalizeSchoolName`:
 * case, accents, punctuation and spacing ignored). An empty result means
 * "unknown school" and never counts as a team-mate of anyone.
 */
export function normalizeSchool(school: string | null | undefined): string {
  return normalizeSchoolName(school);
}

/** The fields of a stored match this helper needs. */
export interface FirstRoundMatchLike {
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
}

export interface SameSchoolFirstRound {
  /** First-round fights between two competitors from the same school. */
  count: number;
  /** First-round fights with two competitors (byes are not fights). */
  fights: number;
  /**
   * The fewest same-school fights any draw with the same byes could have
   * (one school can fill more than half of the fights).
   */
  unavoidable: number;
  matches: Array<{ matchNumber: number; school: string }>;
}

/** Formats where a "first round" means something (not round robin / pools). */
export function hasEliminationFirstRound(format: string | null | undefined): boolean {
  return format === 'double_elim' || format === 'single_elim' || !format;
}

/**
 * Count same-school first-round fights in an elimination bracket.
 * Returns null for round robin and pool play, where everyone meets
 * anyway. `schoolOf` maps a registration id to its school name.
 */
export function countSameSchoolFirstRound(
  format: string | null | undefined,
  matches: FirstRoundMatchLike[],
  schoolOf: (registrationId: string) => string | null | undefined,
): SameSchoolFirstRound | null {
  if (!hasEliminationFirstRound(format)) return null;
  // Round-1 matches live in `winners`; a 2-person single elimination
  // stores its only match as the final (round 1).
  const firstRound = matches.filter((match) =>
    match.roundNumber === 1
    && (match.bracketType === 'winners' || match.bracketType === 'finals')
    && match.competitor1Id
    && match.competitor2Id
  );
  const result: SameSchoolFirstRound = { count: 0, fights: firstRound.length, unavoidable: 0, matches: [] };
  const perSchool = new Map<string, number>();
  for (const match of firstRound) {
    const rawSchool = schoolOf(match.competitor1Id!) ?? '';
    const a = normalizeSchool(rawSchool);
    const b = normalizeSchool(schoolOf(match.competitor2Id!));
    for (const school of [a, b]) {
      if (school) perSchool.set(school, (perSchool.get(school) ?? 0) + 1);
    }
    if (a && a === b) {
      result.count++;
      result.matches.push({ matchNumber: match.matchNumber, school: rawSchool.trim() });
    }
  }
  const largest = Math.max(0, ...perSchool.values());
  result.unavoidable = Math.max(0, largest - result.fights);
  return result;
}

/** Plain-words summary, e.g. "2 first-round fights between team-mates". */
export function describeSameSchoolFights(count: number): string {
  if (count === 0) return 'No first-round fights between team-mates';
  return `${count} first-round fight${count === 1 ? '' : 's'} between team-mates`;
}

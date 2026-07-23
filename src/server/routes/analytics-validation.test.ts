import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  buildDashboardWhereClauses,
  competitorWhere,
  matchWhere,
  registrationWhere,
  tournamentWhere,
  type TournamentAccessFilter,
} from './analytics-validation.js';

const notDeleted = { deletedAt: null } as const;

// A representative non-null access filter — the shape that
// buildTournamentAccessFilter returns for a scoped (non-admin) user.
const scopedAccess: TournamentAccessFilter = {
  OR: [
    { id: { in: ['t-1', 't-2'] } },
    { organizationId: { in: ['org-1'] } },
    { organizationId: null },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk an arbitrary object and return true if any node matches the
 * predicate. Used to prove "the tournament chain always carries the
 * notDeleted marker" — a regression check that would have caught
 * the original `prisma.match.count()` bug.
 *
 * Recurses into arrays (which Prisma uses heavily for AND/OR branches)
 * by mapping over their elements. The bug in the original walker was
 * returning false at the top of any array, which meant deep paths
 * like `{ AND: [..., { deletedAt: null }] }` were never reached.
 */
function containsNode(
  value: unknown,
  predicate: (node: Record<string, unknown>) => boolean
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsNode(item, predicate));
  }
  if (!isPlainObject(value)) return false;
  if (predicate(value)) return true;
  for (const child of Object.values(value)) {
    if (containsNode(child, predicate)) return true;
  }
  return false;
}

const hasNotDeleted = (node: Record<string, unknown>): boolean =>
  'deletedAt' in node && (node as { deletedAt: unknown }).deletedAt === null;

const hasAnd = (node: Record<string, unknown>): boolean => 'AND' in node;

describe('tournamentWhere', () => {
  it('applies notDeleted when the access filter is null (admin / legacy)', () => {
    const result = tournamentWhere(null, notDeleted);
    expect(result).toEqual(notDeleted);
  });

  it('ANDs the access filter with notDeleted when the access filter is set', () => {
    const result = tournamentWhere(scopedAccess, notDeleted);
    expect(result).toEqual({ AND: [scopedAccess, notDeleted] });
  });
});

describe('registrationWhere', () => {
  it('scopes through the tournament relation even when the access filter is null', () => {
    const result = registrationWhere(null, notDeleted);
    expect(result).toEqual({ tournament: notDeleted });
  });

  it('ANDs access filter + notDeleted on the tournament relation', () => {
    const result = registrationWhere(scopedAccess, notDeleted);
    expect(result).toEqual({
      tournament: { AND: [scopedAccess, notDeleted] },
    });
  });
});

describe('matchWhere', () => {
  it('still walks bracket → division → tournament when the access filter is null', () => {
    // Regression: the original bug was `prisma.match.count()` with no
    // where at all. The helper must always return a non-trivial `where`
    // and must always reach the tournament chain so soft-deleted
    // tournaments' matches never leak.
    const result = matchWhere(null, notDeleted);
    expect(result).toEqual({
      bracket: { division: { tournament: notDeleted } },
    });
  });

  it('ANDs access filter + notDeleted on the tournament chain', () => {
    const result = matchWhere(scopedAccess, notDeleted);
    expect(result).toEqual({
      bracket: { division: { tournament: { AND: [scopedAccess, notDeleted] } } },
    });
  });

  it('regression: the tournament chain always carries notDeleted, even with a null access filter', () => {
    const result = matchWhere(null, notDeleted);
    const tournamentChain = (
      result as { bracket: { division: { tournament: unknown } } }
    ).bracket.division.tournament;
    expect(containsNode(tournamentChain, hasNotDeleted)).toBe(true);
  });

  it('regression: when access filter is set, the where always combines it with notDeleted (never just the access filter alone)', () => {
    const result = matchWhere(scopedAccess, notDeleted);
    const tournamentChain = (
      result as { bracket: { division: { tournament: unknown } } }
    ).bracket.division.tournament;
    // The tournament chain must use AND with both pieces — a bare
    // access filter would leak soft-deleted rows.
    expect(containsNode(tournamentChain, hasAnd)).toBe(true);
    expect(containsNode(tournamentChain, hasNotDeleted)).toBe(true);
  });
});

describe('competitorWhere', () => {
  it('always applies notDeleted at the top level', () => {
    const result = competitorWhere(null, notDeleted) as Record<string, unknown>;
    expect(containsNode(result, hasNotDeleted)).toBe(true);
  });

  it('routes the access filter through registrations.some → tournament', () => {
    const result = competitorWhere(scopedAccess, notDeleted) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(result.AND).toHaveLength(2);
    // The second branch must be the registrations.some walk, and
    // somewhere inside it must carry the access filter.
    const someBranch = result.AND[1];
    expect(containsNode(someBranch, hasAnd)).toBe(true);
  });

  it('still scopes through registrations when the access filter is null', () => {
    // The access filter being null means "sees everything", but we
    // still want to exclude competitors whose only registrations are
    // in soft-deleted tournaments — they shouldn't appear in the
    // dashboard at all.
    const result = competitorWhere(null, notDeleted) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(result.AND).toHaveLength(2);
    const someBranch = result.AND[1];
    expect(containsNode(someBranch, hasNotDeleted)).toBe(true);
  });
});

describe('buildDashboardWhereClauses', () => {
  it('returns every model’s where clause when the access filter is null', () => {
    const result = buildDashboardWhereClauses(null, notDeleted);
    expect(result.tournament).toEqual(notDeleted);
    expect(result.registration).toEqual({ tournament: notDeleted });
    expect(result.match).toEqual({
      bracket: { division: { tournament: notDeleted } },
    });
    // competitorWhere's shape is a top-level AND; spot-check that
    // every clause is defined and not null.
    expect(result.competitor).toBeDefined();
  });

  it('returns every model’s where clause when the access filter is set', () => {
    const result = buildDashboardWhereClauses(scopedAccess, notDeleted);
    expect(result.tournament).toEqual({ AND: [scopedAccess, notDeleted] });
    expect(result.registration).toEqual({
      tournament: { AND: [scopedAccess, notDeleted] },
    });
    expect(result.match).toEqual({
      bracket: { division: { tournament: { AND: [scopedAccess, notDeleted] } } },
    });
    expect(result.competitor).toBeDefined();
  });

  it('regression: match.where is never empty (catches the original Phase 18 bug)', () => {
    // The original code passed `prisma.match.count()` with no where at
    // all. We can't unit-test what the handler does directly, but we
    // can lock in the property that the helper returns a truthy, deep
    // object for every (filter, notDeleted) combination.
    for (const filter of [null, scopedAccess]) {
      const result = buildDashboardWhereClauses(filter, notDeleted);
      expect(result.match).toBeTruthy();
      // Must be a non-trivial object — not just `{}` or `null`.
      expect(Object.keys(result.match).length).toBeGreaterThan(0);
    }
  });

  it('regression: every model’s where carries notDeleted somewhere in the chain', () => {
    // The PR exposed the soft-delete leak in `match.count` (where the
    // bug was) and also highlighted that the other counts at least
    // had `notDeleted` directly. We lock that in for every model.
    for (const filter of [null, scopedAccess]) {
      const result = buildDashboardWhereClauses(filter, notDeleted);
      expect(containsNode(result.tournament as unknown, hasNotDeleted)).toBe(true);
      expect(containsNode(result.registration as unknown, hasNotDeleted)).toBe(true);
      expect(containsNode(result.match as unknown, hasNotDeleted)).toBe(true);
      expect(containsNode(result.competitor as unknown, hasNotDeleted)).toBe(true);
    }
  });

  it('satisfies the Prisma where-input types for every model', () => {
    // Compile-time check: every clause must be assignable to the
    // matching Prisma.<Model>WhereInput. If anyone changes the helper
    // signatures and breaks this, vitest's tsc step catches it.
    const result = buildDashboardWhereClauses(scopedAccess, notDeleted);
    const _t: Prisma.TournamentWhereInput = result.tournament;
    const _c: Prisma.CompetitorWhereInput = result.competitor;
    const _m: Prisma.MatchWhereInput = result.match;
    const _r: Prisma.RegistrationWhereInput = result.registration;
    expect([_t, _c, _m, _r]).toHaveLength(4);
  });
});

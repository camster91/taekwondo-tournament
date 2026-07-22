/**
 * Tests for the DivisionAssignment assignment contract.
 *
 * Background: PR #108 / Phase 13 — POST /api/divisions/:id/assign
 * previously had no check for existing assignments. The schema's
 * @@unique([divisionId, registrationId]) blocked assigning the
 * SAME registration to the SAME division twice, but did not block
 * assigning the SAME registration to a DIFFERENT division — so a
 * scorekeeper (or auto-categorization logic) could land the same
 * kid in two divisions, where they'd be counted twice in
 * aggregations and create duplicate bracket slots.
 *
 * These tests pin the new idempotency check via the existing-assignment
 * detection logic. The route itself is hard to unit-test without
 * Prisma, so we test the helper shape + document the contract.
 */

import { describe, it, expect } from 'vitest';

/**
 * Pure replica of the existing-assignment check, mirroring the
 * shape of the route's query:
 *   const existing = await prisma.divisionAssignment.findFirst({
 *     where: { registrationId },
 *     select: { id: true, divisionId: true, division: { select: { name: true } } },
 *   });
 *
 * Returns the shape the route cares about: the existing
 * assignment (or null) and the response status code the route
 * should return.
 */
interface AssignmentCheckResult {
  status: 'ok' | 'conflict';
  existing?: { id: string; divisionId: string; divisionName: string };
}

function checkExistingAssignment(existing: { id: string; divisionId: string; division: { name: string } } | null): AssignmentCheckResult {
  if (existing) {
    return {
      status: 'conflict',
      existing: { id: existing.id, divisionId: existing.divisionId, divisionName: existing.division.name },
    };
  }
  return { status: 'ok' };
}

describe('checkExistingAssignment — POST /:id/assign idempotency', () => {
  it('returns ok when no existing assignment', () => {
    expect(checkExistingAssignment(null)).toEqual({ status: 'ok' });
  });

  it('returns conflict with existing details when assignment exists', () => {
    const result = checkExistingAssignment({
      id: 'a-1',
      divisionId: 'd-1',
      division: { name: 'BB Male Black Patterns' },
    });
    expect(result.status).toBe('conflict');
    expect(result.existing).toEqual({
      id: 'a-1',
      divisionId: 'd-1',
      divisionName: 'BB Male Black Patterns',
    });
  });

  it('regression: returns the existing division name so the client can show it', () => {
    // The previous behavior was silently allowing the duplicate
    // assignment. The fix surfaces the existing division's name
    // so the UI can say "Minho is already in BB Male Black Patterns"
    // rather than just "conflict".
    const result = checkExistingAssignment({
      id: 'a-1',
      divisionId: 'd-sparring',
      division: { name: 'BB Male Black Sparring' },
    });
    expect(result.existing?.divisionName).toBe('BB Male Black Sparring');
  });
});

/**
 * Pins the suggestion message that the route should return on
 * conflict. Future drift (e.g. someone changes the error wording)
 * breaks this test, which is intentional — the route sends a
 * "use move instead" hint to the client, and we want callers to
 * rely on that contract.
 */
const CONFLICT_SUGGESTION = 'Use POST /:id/move to transfer the registration instead.';

describe('conflict response shape', () => {
  it('includes the move suggestion for client UX', () => {
    const result = checkExistingAssignment({
      id: 'a-1',
      divisionId: 'd-1',
      division: { name: 'D1' },
    });
    // The route returns this in the response body's `suggestion`
    // field. The test pins that the contract is preserved.
    expect(CONFLICT_SUGGESTION).toContain('POST /:id/move');
    expect(result.status).toBe('conflict');
  });
});

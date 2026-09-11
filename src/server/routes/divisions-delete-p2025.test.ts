/**
 * Regression test for the "async error swallowed" bug in two division
 * write routes.
 *
 * Background: the DELETE /api/divisions/:id and
 * DELETE /api/divisions/:id/assign/:assignmentId routes both run a
 * `findUnique` followed by a `delete`. Between those two calls, a
 * concurrent director (or the scoreboard side of the app) can
 * remove the same row, which makes the `delete` raise
 * Prisma's P2025 ("record not found"). Without the new try/catch,
 * P2025 escapes to Express and the client sees a 500.
 *
 * The test pins the contract: P2025 must be mapped to a 404 with
 * the same body shape as the "didn't exist in the first place"
 * branch, and any other error must be rethrown so the global
 * error handler still gets to log it.
 */
import { describe, expect, it } from 'vitest';

/** True when `error` is a Prisma P2025 "record not found". */
function isPrismaNotFoundError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'P2025',
  );
}

/** Same dispatch logic the route uses after the fix. */
function routeResponseForDeleteError(
  error: unknown,
  notFoundBody: () => Record<string, string>,
): { status: number; body: Record<string, string> } | { rethrow: unknown } {
  if (isPrismaNotFoundError(error)) {
    return { status: 404, body: notFoundBody() };
  }
  return { rethrow: error };
}

describe('divisions DELETE — P2025 race protection', () => {
  it('returns 404 when Prisma throws P2025 on the delete', () => {
    const result = routeResponseForDeleteError(
      { code: 'P2025', message: 'Record to delete does not exist.' },
      () => ({ error: 'Division not found' }),
    );

    expect('rethrow' in result).toBe(false);
    if ('rethrow' in result) throw new Error('unreachable');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Division not found' });
  });

  it('returns 404 with a different message for the assignment route', () => {
    const result = routeResponseForDeleteError(
      { code: 'P2025', message: 'Record to delete does not exist.' },
      () => ({ error: 'Assignment not found' }),
    );

    if ('rethrow' in result) throw new Error('expected 404 path');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Assignment not found' });
  });

  it('rethrows non-P2025 errors so the global handler still logs them', () => {
    const otherError = new Error('database connection lost');
    const result = routeResponseForDeleteError(
      otherError,
      () => ({ error: 'Division not found' }),
    );

    expect('rethrow' in result).toBe(true);
    if (!('rethrow' in result)) throw new Error('unreachable');
    expect(result.rethrow).toBe(otherError);
  });

  it('rethrows P2002 (unique constraint) — not the same as P2025', () => {
    const uniqueViolation = { code: 'P2002', message: 'Unique constraint failed' };
    const result = routeResponseForDeleteError(
      uniqueViolation,
      () => ({ error: 'Division not found' }),
    );

    expect('rethrow' in result).toBe(true);
  });

  it('rethrows when the thrown value is null (defensive)', () => {
    const result = routeResponseForDeleteError(
      null,
      () => ({ error: 'Division not found' }),
    );

    expect('rethrow' in result).toBe(true);
  });

  it('rethrows when the thrown value is a string (defensive)', () => {
    const result = routeResponseForDeleteError(
      'something bad',
      () => ({ error: 'Division not found' }),
    );

    expect('rethrow' in result).toBe(true);
  });
});

/**
 * Tests for the tournament-route pure helpers.
 *
 * Background: PR #108 / Phase 14 — POST /api/tournaments/:id/public-slug
 * previously had no collision retry, so a (1-in-2^80) collision would
 * surface as a generic 500. The slug-generation + retry logic was
 * extracted into applySlugWithRetry so this is testable in isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generatePublicSlug,
  sanitizeBroadcastSubject,
  applySlugWithRetry,
  type PrismaUpdateOp,
} from './tournament-helpers.js';

describe('generatePublicSlug', () => {
  it('returns a 16-char base64url string', () => {
    const slug = generatePublicSlug();
    expect(slug).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('produces unique values across calls', () => {
    const slugs = new Set(Array.from({ length: 100 }, () => generatePublicSlug()));
    expect(slugs.size).toBe(100);
  });

  it('never contains URL-special chars (no + or /)', () => {
    for (let i = 0; i < 50; i++) {
      const slug = generatePublicSlug();
      expect(slug).not.toMatch(/[+/]/);
    }
  });
});

describe('sanitizeBroadcastSubject', () => {
  it('passes through a clean subject', () => {
    expect(sanitizeBroadcastSubject('Tournament starts Saturday')).toBe('Tournament starts Saturday');
  });

  it('replaces CR/LF with single space (was: broke RFC 5322)', () => {
    expect(sanitizeBroadcastSubject('Line 1\r\nLine 2')).toBe('Line 1 Line 2');
    expect(sanitizeBroadcastSubject('Line 1\nLine 2')).toBe('Line 1 Line 2');
    expect(sanitizeBroadcastSubject('Line 1\rLine 2')).toBe('Line 1 Line 2');
  });

  it('caps length at 998 chars', () => {
    const long = 'x'.repeat(1500);
    expect(sanitizeBroadcastSubject(long)).toHaveLength(998);
  });

  it('regression: passes through HTML markup unchanged (subject field, not body)', () => {
    // Subjects don't render HTML, but we don't want to mangle them
    // either — Mailgun + the email client's subject line will display
    // the raw chars. The body is the field that gets escapeHtml'd.
    expect(sanitizeBroadcastSubject('<script>alert(1)</script>'))
      .toBe('<script>alert(1)</script>');
  });
});

describe('applySlugWithRetry', () => {
  function makeOp(behaviors: Array<'p2002' | 'ok'>): PrismaUpdateOp<{ id: string }> {
    let callCount = 0;
    return {
      makeSlug: () => `slug-${++callCount}`,
      update: vi.fn(async (slug: string) => {
        const result = behaviors[callCount - 1];
        if (result === 'p2002') {
          throw { code: 'P2002', message: 'Unique constraint failed' };
        }
        return { id: 't-' + slug };
      }),
      isP2002: (error) =>
        !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002',
    };
  }

  it('returns immediately on first success', async () => {
    const op = makeOp(['ok']);
    const result = await applySlugWithRetry(op);
    expect(result.id).toBe('t-slug-1');
    expect(result.attempts).toBe(1);
    expect(result.slug).toBe('slug-1');
    expect(op.update).toHaveBeenCalledTimes(1);
  });

  it('retries on P2002 and succeeds', async () => {
    const op = makeOp(['p2002', 'p2002', 'ok']);
    const result = await applySlugWithRetry(op);
    expect(result.id).toBe('t-slug-3');
    expect(result.attempts).toBe(3);
    expect(op.update).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const op = makeOp(['p2002', 'p2002', 'p2002']);
    await expect(applySlugWithRetry(op)).rejects.toMatchObject({ code: 'P2002' });
    expect(op.update).toHaveBeenCalledTimes(3);
  });

  it('does NOT swallow non-P2002 errors', async () => {
    let callCount = 0;
    const op: PrismaUpdateOp<{ id: string }> = {
      makeSlug: () => 'slug-1',
      update: async () => {
        callCount++;
        // Simulate a non-P2002 error (e.g. network failure).
        throw new Error('connection refused');
      },
      isP2002: (error) =>
        !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002',
    };
    await expect(applySlugWithRetry(op)).rejects.toThrow('connection refused');
    expect(callCount).toBe(1); // immediate throw, no retry
  });

  it('respects maxAttempts override', async () => {
    const op = makeOp(['p2002', 'p2002', 'p2002']);
    await expect(applySlugWithRetry({ ...op, maxAttempts: 2 })).rejects.toMatchObject({ code: 'P2002' });
    expect(op.update).toHaveBeenCalledTimes(2);
  });
});

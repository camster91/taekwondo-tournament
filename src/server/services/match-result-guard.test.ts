import { describe, expect, it } from 'vitest';
import { decideMatchResultWrite, matchResultSchema, type MatchResultSnapshot } from './match-result-guard';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const VERSION = new Date('2026-08-07T12:00:00.000Z');

const completed: MatchResultSnapshot = {
  winnerId: A,
  score1: '5',
  score2: '2',
  status: 'completed',
  notes: null,
  updatedAt: VERSION,
};
const ready: MatchResultSnapshot = { ...completed, winnerId: null, score1: null, score2: null, status: 'ready' };

describe('matchResultSchema', () => {
  it('treats blank scores (forfeit / DQ / injury) as absent instead of rejecting them', () => {
    const parsed = matchResultSchema.safeParse({ winnerId: A, status: 'completed', score1: '', score2: '  ' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.score1).toBeUndefined();
    expect(parsed.data?.score2).toBeUndefined();
  });

  it('still rejects malformed scores', () => {
    expect(matchResultSchema.safeParse({ score1: '-1' }).success).toBe(false);
    expect(matchResultSchema.safeParse({ score1: '1000' }).success).toBe(false);
  });

  it('accepts null scores, expectedUpdatedAt and correction', () => {
    const parsed = matchResultSchema.safeParse({
      score1: null,
      expectedUpdatedAt: VERSION.toISOString(),
      correction: true,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('decideMatchResultWrite', () => {
  it('writes a first result on a ready match', () => {
    const decision = decideMatchResultWrite(ready, {
      winnerId: A, score1: '5', score2: '2', status: 'completed', expectedUpdatedAt: VERSION.toISOString(),
    });
    expect(decision).toEqual({
      kind: 'write',
      data: { winnerId: A, score1: '5', score2: '2', status: 'completed', notes: undefined },
    });
  });

  it('rejects a stale expectedUpdatedAt with a conflict', () => {
    const decision = decideMatchResultWrite(ready, {
      winnerId: A, status: 'completed', expectedUpdatedAt: '2026-08-07T11:59:59.000Z',
    });
    expect(decision).toMatchObject({ kind: 'conflict', reason: 'stale_version' });
  });

  it('rejects flipping the winner of a completed match without correction: true', () => {
    // No expected version (an old client) — still must not flip silently.
    const decision = decideMatchResultWrite(completed, { winnerId: B, score1: '1', score2: '6', status: 'completed' });
    expect(decision).toMatchObject({ kind: 'conflict', reason: 'already_recorded' });
  });

  it('rejects clearing a completed winner without correction: true', () => {
    const decision = decideMatchResultWrite(completed, { winnerId: null, status: 'pending' });
    expect(decision).toMatchObject({ kind: 'conflict', reason: 'already_recorded' });
  });

  it('treats an identical resubmission as a no-op, even with an old version (offline replay)', () => {
    const decision = decideMatchResultWrite(
      { ...completed, updatedAt: new Date('2026-08-07T15:00:00.000Z') },
      { winnerId: A, score1: '5', score2: '2', status: 'completed', expectedUpdatedAt: VERSION.toISOString() },
    );
    expect(decision).toEqual({ kind: 'noop' });
  });

  it('allows a director correction and clears scores that would contradict the new winner', () => {
    const decision = decideMatchResultWrite(completed, {
      winnerId: B, status: 'completed', correction: true, expectedUpdatedAt: VERSION.toISOString(),
    });
    expect(decision).toEqual({
      kind: 'write',
      data: { winnerId: B, score1: null, score2: null, status: 'completed', notes: undefined },
    });
  });

  it('keeps explicitly supplied scores on a correction', () => {
    const decision = decideMatchResultWrite(completed, { winnerId: B, score1: '1', score2: '4', correction: true });
    expect(decision).toMatchObject({ kind: 'write', data: { score1: '1', score2: '4' } });
  });

  it('rejects clearing the winner while leaving the match completed (no status)', () => {
    const decision = decideMatchResultWrite(completed, { winnerId: null, correction: true });
    expect(decision).toMatchObject({ kind: 'invalid' });
  });

  it('allows a correction that reopens the match with an explicit status', () => {
    const decision = decideMatchResultWrite(completed, { winnerId: null, status: 'pending', correction: true });
    expect(decision).toMatchObject({ kind: 'write', data: { winnerId: null, status: 'pending' } });
  });

  it('allows a score-only fix on a completed match when the version matches', () => {
    const decision = decideMatchResultWrite(completed, { score1: '6', expectedUpdatedAt: VERSION.toISOString() });
    expect(decision).toMatchObject({ kind: 'write', data: { score1: '6' } });
  });
});

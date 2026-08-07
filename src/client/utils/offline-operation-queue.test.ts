import { describe, expect, it } from 'vitest';
import {
  createOfflineOperationQueue,
  makeCheckInOperation,
  makeScoreOperation,
  type OfflineOperation,
  type QueueStorage,
} from './offline-operation-queue';

function memoryStorage(): QueueStorage & { value: string | null } {
  return {
    value: null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
}

function operation(targetId: string): OfflineOperation {
  return {
    id: `score:${targetId}`,
    kind: 'score_result',
    tournamentId: 'tournament-1',
    ownerId: 'user-1',
    targetId,
    createdAt: '2026-08-07T12:00:00.000Z',
    payload: { winnerId: 'registration-1', score1: '5', score2: '2' },
    status: 'pending',
  };
}

describe('offline operation queue', () => {
  it('builds stable deduplication keys without storing authentication secrets', () => {
    const score = makeScoreOperation('user-1', 'tournament-1', 'match-1', { winnerId: 'registration-1' });
    const checkIn = makeCheckInOperation('user-1', 'tournament-1', 'registration-1', { checkedIn: true });

    expect(score).toMatchObject({ id: 'user-1:score_result:match-1', ownerId: 'user-1', status: 'pending' });
    expect(checkIn).toMatchObject({ id: 'user-1:check_in:registration-1', ownerId: 'user-1', status: 'pending' });
    expect(JSON.stringify([score, checkIn])).not.toMatch(/authorization|cookie|token/i);
  });

  it('persists operations and replaces a duplicate target instead of double-submitting it', () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);

    queue.enqueue(operation('match-1'));
    queue.enqueue({ ...operation('match-1'), payload: { winnerId: 'registration-2' } });

    expect(queue.list()).toHaveLength(1);
    expect(queue.list()[0].payload).toEqual({ winnerId: 'registration-2' });
    expect(storage.value).toContain('registration-2');
  });

  it('flushes in order and retains the first network-failed operation for reconnection', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue(operation('match-2'));
    const attempted: string[] = [];

    const result = await queue.flush(async (item) => {
      attempted.push(item.targetId);
      throw new TypeError('Failed to fetch');
    });

    expect(attempted).toEqual(['match-1']);
    expect(result).toEqual({ synced: 0, needsReview: 0, remaining: 2 });
    expect(queue.list().map((item) => item.status)).toEqual(['pending', 'pending']);
  });

  it('marks rejected server operations for review and continues syncing later items', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue(operation('match-2'));

    const result = await queue.flush(async (item) => {
      if (item.targetId === 'match-1') throw new Error('409 Result changed elsewhere');
    });

    expect(result).toEqual({ synced: 1, needsReview: 1, remaining: 1 });
    expect(queue.list()[0]).toMatchObject({ targetId: 'match-1', status: 'needs_review' });
  });

  it('flushes only operations selected for the active workflow', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue({ ...operation('registration-1'), id: 'check_in:registration-1', kind: 'check_in' });

    const result = await queue.flush(async () => undefined, (item) => item.kind === 'check_in');

    expect(result).toEqual({ synced: 1, needsReview: 0, remaining: 1 });
    expect(queue.list()[0].kind).toBe('score_result');
  });
});

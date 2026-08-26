import { describe, expect, it } from 'vitest';
import {
  createOfflineOperationQueue,
  OfflineQueuePersistenceError,
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
    removeItem() { this.value = null; },
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
  it('purges one signed-out owner without removing another owner operations', () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);
    queue.enqueue(makeCheckInOperation('owner-a', 'tournament-1', 'registration-1', { checkedIn: true }));
    queue.enqueue(makeCheckInOperation('owner-b', 'tournament-1', 'registration-2', { checkedIn: true }));
    expect(queue.removeOwner('owner-a')).toHaveLength(1);
    expect(queue.list()).toEqual([expect.objectContaining({ ownerId: 'owner-b' })]);
    expect(queue.removeOwner('owner-b')).toEqual([]);
    expect(storage.value).toBeNull();
  });
  it('marks an attempted online request as delivery uncertain instead of auto-retryable pending', () => {
    const operation = makeCheckInOperation('owner-1', 'tournament-1', 'registration-1', { checkedIn: true }, 'delivery_uncertain');
    expect(operation.status).toBe('delivery_uncertain');
    expect(operation.lastError).toMatch(/acknowledgement was not received/i);
  });
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

  it('quarantines the first network-uncertain operation and leaves later work queued', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue(operation('match-2'));
    const attempted: string[] = [];

    const result = await queue.flush(async (item) => {
      attempted.push(item.targetId);
      throw new TypeError('Failed to fetch');
    });

    expect(attempted).toEqual(['match-1']);
    expect(result).toEqual({ synced: 0, newlyRejected: 0, persistenceFailuresBeforeSend: 0, persistenceFailuresAfterSend: 0, persistenceFailuresAfterRejection: 0, needsReview: 1, remaining: 2 });
    expect(queue.list().map((item) => item.status)).toEqual(['delivery_uncertain', 'pending']);
  });

  it('marks rejected server operations for review and continues syncing later items', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue(operation('match-2'));

    const result = await queue.flush(async (item) => {
      if (item.targetId === 'match-1') throw new Error('409 Result changed elsewhere');
    });

    expect(result).toEqual({ synced: 1, newlyRejected: 1, persistenceFailuresBeforeSend: 0, persistenceFailuresAfterSend: 0, persistenceFailuresAfterRejection: 0, needsReview: 1, remaining: 1 });
    expect(queue.list()[0]).toMatchObject({ targetId: 'match-1', status: 'needs_review' });
  });

  it('raises a typed error when the device cannot persist an offline operation', () => {
    const storage: QueueStorage = {
      getItem: () => '[]',
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    };
    const queue = createOfflineOperationQueue(storage);

    expect(() => queue.enqueue(operation('match-1'))).toThrow(OfflineQueuePersistenceError);
    expect(() => queue.enqueue(operation('match-1'))).toThrow('Could not save the offline operation on this device');
  });

  it('retries one reviewed operation without changing other rejected work', async () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);
    queue.enqueue(makeScoreOperation('owner-1', 'tournament-1', 'match-1', {}));
    queue.enqueue(makeScoreOperation('owner-1', 'tournament-1', 'match-2', {}));

    await queue.flush(async () => {
      throw new Error('409 Match changed on the server');
    });
    const [first, second] = queue.list();

    const result = await queue.retryOne(first.id, async () => undefined);

    expect(result).toEqual({ outcome: 'synced' });
    expect(queue.list()).toEqual([second]);
  });

  it('quarantines a retry in flight and updates only its error on rejection', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue(operation('match-2'));
    await queue.flush(async () => { throw new Error('409 Original conflict'); });
    const [first, second] = queue.list();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });

    const retry = queue.retryOne(first.id, async () => {
      await blocked;
      throw new Error('409 Updated conflict');
    });
    expect(queue.list()[0]).toMatchObject({ status: 'delivery_uncertain', lastError: '409 Original conflict' });
    release();
    expect(await retry).toEqual({ outcome: 'rejected' });
    expect(queue.list()[0]).toMatchObject({ id: first.id, status: 'needs_review', lastError: '409 Updated conflict' });
    expect(queue.list()[1]).toEqual(second);
  });

  it('preserves a newer same-target operation when the older retry succeeds', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    await queue.flush(async () => { throw new Error('409 Original conflict'); });
    const reviewed = queue.list()[0];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const retry = queue.retryOne(reviewed.id, async () => blocked);

    const newer = { ...operation('match-1'), createdAt: '2026-08-09T15:00:00.000Z', payload: { winnerId: 'registration-new' } };
    queue.enqueue(newer);
    release();

    expect(await retry).toEqual({ outcome: 'superseded' });
    expect(queue.list()).toEqual([newer]);
  });

  it('does not overwrite a newer same-target operation when the older retry is rejected', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    await queue.flush(async () => { throw new Error('409 Original conflict'); });
    const reviewed = queue.list()[0];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const retry = queue.retryOne(reviewed.id, async () => {
      await blocked;
      throw new Error('409 Old retry rejected');
    });

    const newer = { ...operation('match-1'), createdAt: '2026-08-09T15:00:00.000Z', payload: { winnerId: 'registration-new' } };
    queue.enqueue(newer);
    release();

    expect(await retry).toEqual({ outcome: 'superseded' });
    expect(queue.list()).toEqual([newer]);
  });

  it('reports ambiguous persistence when the server accepts a retry but local removal cannot be saved', async () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);
    queue.enqueue(operation('match-1'));
    await queue.flush(async () => { throw new Error('409 Original conflict'); });
    const reviewed = queue.list()[0];
    const persist = storage.setItem.bind(storage);
    let writes = 0;
    storage.setItem = (key, value) => {
      writes += 1;
      if (writes === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      persist(key, value);
    };

    const result = await queue.retryOne(reviewed.id, async () => undefined);

    expect(result).toEqual({ outcome: 'persistence_failed_after_send' });
    expect(queue.list()[0]).toMatchObject({ id: reviewed.id, status: 'delivery_uncertain' });
    let resendCount = 0;
    expect(await queue.retryOne(reviewed.id, async () => { resendCount += 1; })).toEqual({ outcome: 'missing' });
    expect(resendCount).toBe(0);
  });

  it('quarantines a retry when rejection detail cannot be persisted', async () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);
    queue.enqueue(operation('match-1'));
    await queue.flush(async () => { throw new Error('409 Original conflict'); });
    const reviewed = queue.list()[0];
    const persist = storage.setItem.bind(storage);
    let writes = 0;
    storage.setItem = (key, value) => {
      writes += 1;
      if (writes === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      persist(key, value);
    };

    const result = await queue.retryOne(reviewed.id, async () => { throw new Error('409 Updated conflict'); });

    expect(result).toEqual({ outcome: 'persistence_failed_after_rejection' });
    expect(queue.list()[0]).toMatchObject({ id: reviewed.id, status: 'delivery_uncertain' });
  });

  it('flushes only operations selected for the active workflow', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    queue.enqueue({ ...operation('registration-1'), id: 'check_in:registration-1', kind: 'check_in' });

    const result = await queue.flush(async () => undefined, (item) => item.kind === 'check_in');

    expect(result).toEqual({ synced: 1, newlyRejected: 0, persistenceFailuresBeforeSend: 0, persistenceFailuresAfterSend: 0, persistenceFailuresAfterRejection: 0, needsReview: 0, remaining: 1 });
    expect(queue.list()[0].kind).toBe('score_result');
  });

  it('does not report an existing reviewed operation as newly rejected', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    queue.enqueue(operation('match-1'));
    await queue.flush(async () => { throw new Error('409 Conflict'); });

    const result = await queue.flush(async () => undefined);

    expect(result).toEqual({ synced: 0, newlyRejected: 0, persistenceFailuresBeforeSend: 0, persistenceFailuresAfterSend: 0, persistenceFailuresAfterRejection: 0, needsReview: 1, remaining: 1 });
  });

  it('quarantines a globally rejected operation when its rejection detail cannot be persisted', async () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);
    queue.enqueue(operation('match-1'));
    const persist = storage.setItem.bind(storage);
    let writes = 0;
    storage.setItem = (key, value) => {
      writes += 1;
      if (writes === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      persist(key, value);
    };

    const result = await queue.flush(async () => { throw new Error('409 Conflict'); });

    expect(result.persistenceFailuresAfterRejection).toBe(1);
    expect(queue.list()[0]).toMatchObject({ status: 'delivery_uncertain' });
  });

  it('reports a pre-send persistence failure without sending or changing the pending item', async () => {
    const storage = memoryStorage();
    const queue = createOfflineOperationQueue(storage);
    queue.enqueue(operation('match-1'));
    storage.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    let sends = 0;

    const result = await queue.flush(async () => { sends += 1; });

    expect(result.persistenceFailuresBeforeSend).toBe(1);
    expect(sends).toBe(0);
    expect(queue.list()[0]).toMatchObject({ status: 'pending' });
  });

  it('does not remove a newer same-target operation after an older global sync succeeds', async () => {
    const queue = createOfflineOperationQueue(memoryStorage());
    const older = operation('match-1');
    queue.enqueue(older);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const syncing = queue.flush(async () => blocked);
    const newer = { ...operation('match-1'), createdAt: '2026-08-09T15:00:00.000Z', payload: { winnerId: 'registration-new' } };
    queue.enqueue(newer);
    release();

    const result = await syncing;

    expect(result.synced).toBe(0);
    expect(queue.list()).toEqual([newer]);
  });
});

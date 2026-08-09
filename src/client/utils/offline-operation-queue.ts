export type OfflineOperationKind = 'score_result' | 'check_in';
export type OfflineOperationStatus = 'pending' | 'needs_review' | 'delivery_uncertain';

export interface OfflineOperation {
  id: string;
  kind: OfflineOperationKind;
  ownerId: string;
  tournamentId: string;
  targetId: string;
  revision?: string;
  createdAt: string;
  payload: Record<string, unknown>;
  status: OfflineOperationStatus;
  lastError?: string;
}

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class OfflineQueuePersistenceError extends Error {
  constructor() {
    super('Could not save the offline operation on this device');
    this.name = 'OfflineQueuePersistenceError';
  }
}

export interface FlushResult {
  synced: number;
  newlyRejected: number;
  persistenceFailuresBeforeSend: number;
  persistenceFailuresAfterSend: number;
  persistenceFailuresAfterRejection: number;
  needsReview: number;
  remaining: number;
}

const STORAGE_KEY = 'bowin_offline_operations_v1';

function makeOperation(
  kind: OfflineOperationKind,
  ownerId: string,
  tournamentId: string,
  targetId: string,
  payload: Record<string, unknown>,
): OfflineOperation {
  return {
    id: `${ownerId}:${kind}:${targetId}`,
    kind,
    ownerId,
    tournamentId,
    targetId,
    revision: globalThis.crypto.randomUUID(),
    payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

export function makeScoreOperation(ownerId: string, tournamentId: string, matchId: string, payload: Record<string, unknown>) {
  return makeOperation('score_result', ownerId, tournamentId, matchId, payload);
}

export function makeCheckInOperation(ownerId: string, tournamentId: string, registrationId: string, payload: Record<string, unknown>) {
  return makeOperation('check_in', ownerId, tournamentId, registrationId, payload);
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function isSameOperationRevision(current: OfflineOperation, retried: OfflineOperation): boolean {
  if (current.revision || retried.revision) return current.revision === retried.revision;
  return current.createdAt === retried.createdAt && JSON.stringify(current.payload) === JSON.stringify(retried.payload);
}

export function createOfflineOperationQueue(storage: QueueStorage) {
  const read = (): OfflineOperation[] => {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (items: OfflineOperation[]) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      throw new OfflineQueuePersistenceError();
    }
  };

  return {
    list: read,
    enqueue(item: OfflineOperation) {
      const items = read();
      const existing = items.findIndex((candidate) => candidate.id === item.id);
      if (existing >= 0) items[existing] = item;
      else items.push(item);
      write(items);
      return items;
    },
    remove(id: string) {
      const items = read().filter((item) => item.id !== id);
      write(items);
      return items;
    },
    async retryOne(id: string, send: (item: OfflineOperation) => Promise<void>) {
      const prepared = read();
      const index = prepared.findIndex((candidate) => candidate.id === id && candidate.status === 'needs_review');
      if (index < 0) return { outcome: 'missing' as const };
      const item = { ...prepared[index], payload: { ...prepared[index].payload } };
      prepared[index].status = 'delivery_uncertain';
      try {
        write(prepared);
      } catch (error) {
        if (error instanceof OfflineQueuePersistenceError) return { outcome: 'persistence_failed_before_send' as const };
        throw error;
      }
      let sendError: unknown;
      try {
        await send(item);
      } catch (error) {
        sendError = error;
      }
      if (sendError === undefined) {
        const current = read();
        const index = current.findIndex((candidate) => candidate.id === id);
        if (index < 0) return { outcome: 'missing' as const };
        if (!isSameOperationRevision(current[index], item)) return { outcome: 'superseded' as const };
        current.splice(index, 1);
        try {
          write(current);
        } catch (error) {
          if (error instanceof OfflineQueuePersistenceError) return { outcome: 'persistence_failed_after_send' as const };
          throw error;
        }
        return { outcome: 'synced' as const };
      } else {
        if (isNetworkError(sendError)) return { outcome: 'delivery_uncertain' as const };
        const current = read();
        const reviewed = current.find((candidate) => candidate.id === id);
        if (!reviewed) return { outcome: 'missing' as const };
        if (!isSameOperationRevision(reviewed, item)) return { outcome: 'superseded' as const };
        reviewed.status = 'needs_review';
        reviewed.lastError = sendError instanceof Error ? sendError.message : 'Server rejected operation';
        try {
          write(current);
        } catch (error) {
          if (error instanceof OfflineQueuePersistenceError) return { outcome: 'persistence_failed_after_rejection' as const };
          throw error;
        }
        return { outcome: 'rejected' as const };
      }
    },
    async flush(
      send: (item: OfflineOperation) => Promise<void>,
      shouldProcess: (item: OfflineOperation) => boolean = () => true,
    ): Promise<FlushResult> {
      const candidates = read().filter(shouldProcess);
      let synced = 0;
      let newlyRejected = 0;
      let persistenceFailuresBeforeSend = 0;
      let persistenceFailuresAfterSend = 0;
      let persistenceFailuresAfterRejection = 0;
      for (const item of candidates) {
        if (item.status === 'needs_review') continue;
        const prepared = read();
        const preparedItem = prepared.find((candidate) => candidate.id === item.id);
        if (!preparedItem || preparedItem.status !== 'pending' || !isSameOperationRevision(preparedItem, item)) continue;
        preparedItem.status = 'delivery_uncertain';
        try {
          write(prepared);
        } catch (error) {
          if (error instanceof OfflineQueuePersistenceError) {
            persistenceFailuresBeforeSend += 1;
            break;
          }
          throw error;
        }
        try {
          await send(item);
          const current = read();
          const index = current.findIndex((candidate) => candidate.id === item.id);
          if (index < 0 || !isSameOperationRevision(current[index], item)) continue;
          current.splice(index, 1);
          try {
            write(current);
            synced += 1;
          } catch (error) {
            if (error instanceof OfflineQueuePersistenceError) {
              persistenceFailuresAfterSend += 1;
              break;
            }
            throw error;
          }
        } catch (error) {
          if (isNetworkError(error)) break;
          if (error instanceof OfflineQueuePersistenceError) break;
          const current = read();
          const reviewed = current.find((candidate) => candidate.id === item.id);
          if (!reviewed || !isSameOperationRevision(reviewed, item)) continue;
          reviewed.status = 'needs_review';
          reviewed.lastError = error instanceof Error ? error.message : 'Server rejected operation';
          newlyRejected += 1;
          try {
            write(current);
          } catch (writeError) {
            if (writeError instanceof OfflineQueuePersistenceError) {
              persistenceFailuresAfterRejection += 1;
              break;
            }
            throw writeError;
          }
        }
      }
      const remaining = read();
      const needsReview = remaining.filter((item) => shouldProcess(item) && item.status !== 'pending').length;
      return { synced, newlyRejected, persistenceFailuresBeforeSend, persistenceFailuresAfterSend, persistenceFailuresAfterRejection, needsReview, remaining: remaining.length };
    },
  };
}

export function browserOfflineOperationQueue() {
  return createOfflineOperationQueue(window.localStorage);
}

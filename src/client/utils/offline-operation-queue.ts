export type OfflineOperationKind = 'score_result' | 'check_in';
export type OfflineOperationStatus = 'pending' | 'needs_review';

export interface OfflineOperation {
  id: string;
  kind: OfflineOperationKind;
  ownerId: string;
  tournamentId: string;
  targetId: string;
  createdAt: string;
  payload: Record<string, unknown>;
  status: OfflineOperationStatus;
  lastError?: string;
}

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FlushResult {
  synced: number;
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

export function createOfflineOperationQueue(storage: QueueStorage) {
  const read = (): OfflineOperation[] => {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (items: OfflineOperation[]) => storage.setItem(STORAGE_KEY, JSON.stringify(items));

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
    async flush(
      send: (item: OfflineOperation) => Promise<void>,
      shouldProcess: (item: OfflineOperation) => boolean = () => true,
    ): Promise<FlushResult> {
      const items = read();
      let synced = 0;
      let needsReview = 0;
      for (let index = 0; index < items.length;) {
        const item = items[index];
        if (!shouldProcess(item)) {
          index += 1;
          continue;
        }
        if (item.status === 'needs_review') {
          needsReview += 1;
          index += 1;
          continue;
        }
        try {
          await send(item);
          items.splice(index, 1);
          synced += 1;
          write(items);
        } catch (error) {
          if (isNetworkError(error)) break;
          item.status = 'needs_review';
          item.lastError = error instanceof Error ? error.message : 'Server rejected operation';
          needsReview += 1;
          index += 1;
          write(items);
        }
      }
      return { synced, needsReview, remaining: items.length };
    },
  };
}

export function browserOfflineOperationQueue() {
  return createOfflineOperationQueue(window.localStorage);
}

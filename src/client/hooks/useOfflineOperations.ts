import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import {
  browserOfflineOperationQueue,
  type OfflineOperation,
  type OfflineOperationKind,
} from '../utils/offline-operation-queue';

async function sendOperation(operation: OfflineOperation): Promise<void> {
  const url = operation.kind === 'score_result'
    ? `/api/brackets/match/${operation.targetId}`
    : `/api/tournaments/${operation.tournamentId}/registrations/${operation.targetId}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(operation.payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${response.status} ${body.error || 'Server rejected queued operation'}`);
  }
}

export function useOfflineOperations(tournamentId: string | undefined, kind?: OfflineOperationKind) {
  const { user } = useAuth();
  const queue = useMemo(() => browserOfflineOperationQueue(), []);
  const [operations, setOperations] = useState<OfflineOperation[]>(() => queue.list());
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refresh = useCallback(() => setOperations(queue.list()), [queue]);
  const enqueue = useCallback((operation: OfflineOperation) => {
    setOperations(queue.enqueue(operation));
  }, [queue]);
  const remove = useCallback((id: string) => setOperations(queue.remove(id)), [queue]);

  const sync = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return null;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await queue.flush(sendOperation, (operation) =>
        operation.ownerId === user?.id
        && (!tournamentId || operation.tournamentId === tournamentId)
        && (!kind || operation.kind === kind));
      refresh();
      return result;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [kind, queue, refresh, tournamentId, user?.id]);

  useEffect(() => {
    const handleOnline = () => { void sync(); };
    window.addEventListener('online', handleOnline);
    if (navigator.onLine) void sync();
    return () => window.removeEventListener('online', handleOnline);
  }, [sync]);

  const scoped = operations.filter((operation) =>
    operation.ownerId === user?.id
    && (!tournamentId || operation.tournamentId === tournamentId)
    && (!kind || operation.kind === kind));
  return {
    operations: scoped,
    pending: scoped.filter((operation) => operation.status === 'pending'),
    needsReview: scoped.filter((operation) => operation.status === 'needs_review'),
    enqueue,
    remove,
    sync,
    syncing,
  };
}

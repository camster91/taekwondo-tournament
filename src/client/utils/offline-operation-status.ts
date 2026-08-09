import type { OperationState } from '../components/ui/OperationStatus';

export function buildOfflineOperationStatuses(
  kind: 'result' | 'check-in',
  pending: number,
  needsReview: number,
  syncing: boolean,
): Array<{ state: OperationState; message: string }> {
  const statuses: Array<{ state: OperationState; message: string }> = [];
  if (needsReview > 0) {
    const owner = kind === 'result' ? 'director' : 'staff';
    statuses.push({
      state: 'rejected',
      message: `${needsReview} ${kind}${needsReview === 1 ? '' : 's'} needs ${owner} review`,
    });
  }
  if (pending > 0) {
    statuses.push({
      state: syncing ? 'retrying' : 'queued',
      message: `${pending} ${kind}${pending === 1 ? '' : 's'} pending sync`,
    });
  }
  return statuses;
}

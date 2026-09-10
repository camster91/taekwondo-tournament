import type { OperationState } from '../components/ui/OperationStatus';
import type { OfflineOperation, OfflineOperationKind } from './offline-operation-queue';

export function pendingOfflineTargetIds(
  operations: OfflineOperation[],
  kind: OfflineOperationKind,
): Set<string> {
  return new Set(operations
    .filter((operation) => operation.kind === kind && operation.status === 'pending')
    .map((operation) => operation.targetId));
}

export function buildOfflineReviewMessage(
  kind: 'result' | 'check-in',
  targetId: string,
  lastError?: string,
  detail?: { label?: string; attempted?: string; createdAt?: string },
): string {
  const label = kind === 'result' ? 'Result' : 'Check-in';
  const target = kind === 'result' ? 'match' : 'registration';
  const staged = kind === 'result' ? 'result' : 'check-in';
  const reason = lastError?.trim() || 'Server did not accept the change';
  const subject = detail?.label || `${label} #${targetId.slice(0, 8)}`;
  const attempted = detail?.attempted ? ` Attempted: ${detail.attempted}.` : '';
  const stagedAt = detail?.createdAt
    ? ` Staged ${new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto',
    }).format(new Date(detail.createdAt))}.`
    : '';
  return `${subject} was rejected by server: ${reason}.${attempted}${stagedAt} Review the current ${target} state, then retry or discard this local ${staged}.`;
}

export function buildDeliveryUncertainMessage(kind: 'result' | 'check-in', label: string): string {
  const target = kind === 'result' ? 'match' : 'registration';
  return `${label} may already be saved on the server (network timeout). Refresh to verify the current ${target} state before discarding this local copy. Retry is disabled to prevent duplicates.`;
}

export function buildOfflineOperationStatuses(
  kind: 'result' | 'check-in',
  pending: number,
  _needsReview: number,
  syncing: boolean,
): Array<{ state: OperationState; message: string }> {
  const statuses: Array<{ state: OperationState; message: string }> = [];
  if (pending > 0) {
    statuses.push({
      state: syncing ? 'retrying' : 'queued',
      message: `${pending} ${kind}${pending === 1 ? '' : 's'} pending sync`,
    });
  }
  return statuses;
}

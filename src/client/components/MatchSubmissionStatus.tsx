import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { type OfflineOperation } from '../utils/offline-operation-queue';

export type SubmissionState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'pending-offline'
  | 'failed'
  | 'conflict'
  | 'retrying';

export interface MatchSubmissionStatusProps {
  matchId: string;
  operations: OfflineOperation[];
  onRetry?: (operationId: string) => void;
  onDismiss?: (operationId: string) => void;
  className?: string;
}

/**
 * Match submission status indicator for #138 (scorekeeper save truth).
 * Shows explicit state for each match result submission:
 * - Saving: Request in progress
 * - Saved: Confirmed by server
 * - Pending-offline: Queued, will sync when online
 * - Failed: Server rejected (needs review)
 * - Conflict: Another scorekeeper updated first (needs manual resolution)
 * - Retrying: Attempting to resend after failure
 */
export default function MatchSubmissionStatus({
  matchId,
  operations,
  onRetry,
  onDismiss,
  className = '',
}: MatchSubmissionStatusProps) {
  const matchOps = operations.filter(
    (op) => op.kind === 'score_result' && op.targetId === matchId
  );

  if (matchOps.length === 0) {
    return null;
  }

  const latestOp = matchOps[matchOps.length - 1];
  const state = getSubmissionState(latestOp);

  const config = getStatusConfig(state);

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${config.bgClass} ${config.borderClass} ${config.textClass} ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <config.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{config.message}</span>
      {config.actions && (
        <div className="flex items-center gap-2">
          {config.actions.includes('retry') && onRetry && (
            <button
              onClick={() => onRetry(latestOp.id)}
              className="rounded px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Retry submission"
            >
              Retry
            </button>
          )}
          {config.actions.includes('dismiss') && onDismiss && (
            <button
              onClick={() => onDismiss(latestOp.id)}
              className="rounded px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Dismiss notification"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getSubmissionState(operation: OfflineOperation): SubmissionState {
  if (operation.status === 'delivery_uncertain') {
    return 'pending-offline';
  }
  if (operation.status === 'needs_review') {
    if (operation.lastError?.includes('409') || operation.lastError?.includes('another scorekeeper')) {
      return 'conflict';
    }
    return 'failed';
  }
  return 'saving';
}

interface StatusConfig {
  Icon: React.ComponentType<{ className?: string }>;
  message: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  actions?: ('retry' | 'dismiss')[];
}

function getStatusConfig(state: SubmissionState): StatusConfig {
  switch (state) {
    case 'idle':
      return {
        Icon: CheckCircle2,
        message: 'No pending changes',
        bgClass: 'bg-gray-50 dark:bg-gray-800',
        borderClass: 'border-gray-200 dark:border-gray-700',
        textClass: 'text-gray-700 dark:text-gray-300',
      };

    case 'saving':
      return {
        Icon: Loader2,
        message: 'Saving result...',
        bgClass: 'bg-blue-50 dark:bg-blue-950/40',
        borderClass: 'border-blue-200 dark:border-blue-900',
        textClass: 'text-blue-950 dark:text-blue-100',
      };

    case 'saved':
      return {
        Icon: CheckCircle2,
        message: 'Result saved',
        bgClass: 'bg-emerald-50 dark:bg-emerald-950/40',
        borderClass: 'border-emerald-200 dark:border-emerald-900',
        textClass: 'text-emerald-950 dark:text-emerald-100',
        actions: ['dismiss'],
      };

    case 'pending-offline':
      return {
        Icon: WifiOff,
        message: 'Saved locally. Will sync when connection returns.',
        bgClass: 'bg-amber-50 dark:bg-amber-950/40',
        borderClass: 'border-amber-200 dark:border-amber-900',
        textClass: 'text-amber-950 dark:text-amber-100',
      };

    case 'failed':
      return {
        Icon: AlertCircle,
        message: 'Server rejected result. Review and retry.',
        bgClass: 'bg-rose-50 dark:bg-rose-950/40',
        borderClass: 'border-rose-200 dark:border-rose-900',
        textClass: 'text-rose-950 dark:text-rose-100',
        actions: ['retry', 'dismiss'],
      };

    case 'conflict':
      return {
        Icon: AlertCircle,
        message: 'Another scorekeeper updated this match. Refresh before continuing.',
        bgClass: 'bg-orange-50 dark:bg-orange-950/40',
        borderClass: 'border-orange-200 dark:border-orange-900',
        textClass: 'text-orange-950 dark:text-orange-100',
        actions: ['dismiss'],
      };

    case 'retrying':
      return {
        Icon: RefreshCw,
        message: 'Retrying...',
        bgClass: 'bg-blue-50 dark:bg-blue-950/40',
        borderClass: 'border-blue-200 dark:border-blue-900',
        textClass: 'text-blue-950 dark:text-blue-100',
      };
  }
}

/**
 * Compact inline submission status for match cards
 */
export function InlineSubmissionBadge({ state }: { state: SubmissionState }) {
  const config = getStatusConfig(state);
  const shortMessages: Record<SubmissionState, string> = {
    idle: '',
    saving: 'Saving...',
    saved: 'Saved',
    'pending-offline': 'Queued',
    failed: 'Failed',
    conflict: 'Conflict',
    retrying: 'Retrying...',
  };

  if (state === 'idle' || state === 'saved') {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${config.bgClass} ${config.textClass}`}
      role="status"
      aria-label={config.message}
    >
      <config.Icon className="h-3 w-3" aria-hidden="true" />
      {shortMessages[state]}
    </span>
  );
}

import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Trash2, X } from 'lucide-react';
import { type OfflineOperation } from '../utils/offline-operation-queue';
import { useState } from 'react';

export interface PendingOperationsPanelProps {
  operations: OfflineOperation[];
  onRetry: (operationId: string) => Promise<void>;
  onRemove: (operationId: string) => void;
  onRetryAll: () => Promise<void>;
  isOnline: boolean;
  syncing: boolean;
  className?: string;
}

/**
 * Comprehensive pending operations panel for #138 (scorekeeper save truth).
 * Shows all queued match submissions with individual retry/remove actions.
 * Groups operations by status: pending, needs_review, delivery_uncertain.
 */
export default function PendingOperationsPanel({
  operations,
  onRetry,
  onRemove,
  onRetryAll,
  isOnline,
  syncing,
  className = '',
}: PendingOperationsPanelProps) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  const handleRetry = async (id: string) => {
    setRetryingIds((prev) => new Set(prev).add(id));
    try {
      await onRetry(id);
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const pending = operations.filter((op) => op.status === 'pending');
  const needsReview = operations.filter((op) => op.status === 'needs_review');
  const uncertain = operations.filter((op) => op.status === 'delivery_uncertain');

  if (operations.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Pending Operations ({operations.length})
          </h3>
        </div>
        {needsReview.length > 0 && isOnline && !syncing && (
          <button
            onClick={onRetryAll}
            disabled={syncing}
            className="flex items-center gap-1 rounded px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            aria-label="Retry all failed operations"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry All
          </button>
        )}
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {pending.length > 0 && (
          <OperationGroup
            title="Pending Sync"
            operations={pending}
            icon={Clock}
            iconColor="text-blue-500 dark:text-blue-400"
            description={isOnline ? 'Syncing automatically...' : 'Will sync when connection returns'}
            onRetry={handleRetry}
            onRemove={onRemove}
            retryingIds={retryingIds}
            showRetry={false}
          />
        )}

        {needsReview.length > 0 && (
          <OperationGroup
            title="Needs Review"
            operations={needsReview}
            icon={AlertTriangle}
            iconColor="text-orange-500 dark:text-orange-400"
            description="Server rejected these operations. Review and retry."
            onRetry={handleRetry}
            onRemove={onRemove}
            retryingIds={retryingIds}
            showRetry={isOnline}
          />
        )}

        {uncertain.length > 0 && (
          <OperationGroup
            title="Delivery Uncertain"
            operations={uncertain}
            icon={AlertTriangle}
            iconColor="text-amber-500 dark:text-amber-400"
            description="Server may have received these. Do not retry unless match state is stale."
            onRetry={handleRetry}
            onRemove={onRemove}
            retryingIds={retryingIds}
            showRetry={isOnline}
          />
        )}
      </div>
    </div>
  );
}

interface OperationGroupProps {
  title: string;
  operations: OfflineOperation[];
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  description: string;
  onRetry: (id: string) => Promise<void>;
  onRemove: (id: string) => void;
  retryingIds: Set<string>;
  showRetry: boolean;
}

function OperationGroup({
  title,
  operations,
  icon: Icon,
  iconColor,
  description,
  onRetry,
  onRemove,
  retryingIds,
  showRetry,
}: OperationGroupProps) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
          <div className="text-xs text-gray-600 dark:text-gray-400">{description}</div>
        </div>
      </div>

      <ul className="space-y-2">
        {operations.map((op) => (
          <OperationItem
            key={op.id}
            operation={op}
            onRetry={onRetry}
            onRemove={onRemove}
            isRetrying={retryingIds.has(op.id)}
            showRetry={showRetry}
          />
        ))}
      </ul>
    </div>
  );
}

interface OperationItemProps {
  operation: OfflineOperation;
  onRetry: (id: string) => Promise<void>;
  onRemove: (id: string) => void;
  isRetrying: boolean;
  showRetry: boolean;
}

function OperationItem({
  operation,
  onRetry,
  onRemove,
  isRetrying,
  showRetry,
}: OperationItemProps) {
  const isConflict =
    operation.lastError?.includes('409') || operation.lastError?.includes('another scorekeeper');

  return (
    <li className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex-1">
        <div className="font-medium text-gray-900 dark:text-gray-100">
          {operation.kind === 'score_result' ? 'Match result' : 'Check-in'} •{' '}
          <span className="font-normal text-gray-600 dark:text-gray-400">
            {operation.targetId.slice(0, 8)}...
          </span>
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {new Date(operation.createdAt).toLocaleString()}
        </div>
        {operation.lastError && (
          <div
            className={`mt-2 rounded px-2 py-1 text-xs ${isConflict ? 'bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200' : 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200'}`}
          >
            {isConflict ? (
              <>
                <strong>Conflict:</strong> {operation.lastError}
              </>
            ) : (
              <>
                <strong>Error:</strong> {operation.lastError}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {showRetry && (
          <button
            onClick={() => onRetry(operation.id)}
            disabled={isRetrying}
            className="rounded p-1.5 text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            aria-label="Retry operation"
            title="Retry"
          >
            {isRetrying ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
        <button
          onClick={() => onRemove(operation.id)}
          className="rounded p-1.5 text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/40"
          aria-label="Remove operation"
          title="Remove"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

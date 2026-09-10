import { AlertTriangle, CheckCircle2, CloudOff, LoaderCircle, RefreshCw, Save } from 'lucide-react';
import type { ReactNode } from 'react';

export type OperationState = 'pending' | 'saved' | 'queued' | 'retrying' | 'rejected' | 'resolved';

const labels: Record<OperationState, string> = {
  pending: 'Saving',
  saved: 'Saved',
  queued: 'Queued offline',
  retrying: 'Retrying',
  rejected: 'Needs review',
  resolved: 'Resolved',
};

export function operationStatusLabel(state: OperationState): string {
  return labels[state];
}

const styles: Record<OperationState, string> = {
  pending: 'border-info/20 bg-info/10 text-info dark:border-info/30 dark:bg-info/20 dark:text-info',
  saved: 'border-success/20 bg-success/10 text-success dark:border-success/30 dark:bg-success/20 dark:text-success',
  queued: 'border-warning/20 bg-warning/10 text-warning dark:border-warning/30 dark:bg-warning/20 dark:text-warning',
  retrying: 'border-info/20 bg-info/10 text-info dark:border-info/30 dark:bg-info/20 dark:text-info',
  rejected: 'border-danger/20 bg-danger/10 text-danger dark:border-danger/30 dark:bg-danger/20 dark:text-danger',
  resolved: 'border-success/20 bg-success/10 text-success dark:border-success/30 dark:bg-success/20 dark:text-success',
};

const icons = {
  pending: LoaderCircle,
  saved: Save,
  queued: CloudOff,
  retrying: RefreshCw,
  rejected: AlertTriangle,
  resolved: CheckCircle2,
};

export default function OperationStatus({ state, message, actionLabel, onAction, className = '', children }: {
  state: OperationState;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const Icon = icons[state];
  const active = state === 'pending' || state === 'retrying';
  return (
    <div
      role={state === 'rejected' ? 'alert' : 'status'}
      aria-live={state === 'rejected' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${styles[state]} ${className}`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${active ? 'animate-spin' : ''}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{operationStatusLabel(state)}</p>
        <p className="mt-0.5">{message}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="min-h-11 rounded-lg border border-current px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  );
}

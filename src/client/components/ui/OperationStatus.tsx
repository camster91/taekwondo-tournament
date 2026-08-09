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
  pending: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
  saved: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  queued: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  retrying: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
  rejected: 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
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
      className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${styles[state]} ${className}`}
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

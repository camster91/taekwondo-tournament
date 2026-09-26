import { Link } from 'react-router-dom';
import type { BracketConnectionError } from '../hooks/useBracketWebSocket';

interface LiveUpdatesNoticeProps {
  error: BracketConnectionError;
  onRetry: () => void;
  className?: string;
}

/**
 * Shown when the bracket live-update socket was closed for an auth or
 * permission reason. The hook stops reconnecting in that case, so without
 * this notice other operators' changes silently stop appearing.
 */
export default function LiveUpdatesNotice({ error, onRetry, className = '' }: LiveUpdatesNoticeProps) {
  if (!error) return null;
  const message = error === 'unauthorized'
    ? 'Live updates stopped because your session ended. Sign in again to see other operators’ changes as they happen.'
    : 'Live updates stopped because you no longer have access to this division. Other operators’ changes will not appear automatically.';
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded border border-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 ${className}`}
    >
      <span>{message}</span>
      {error === 'unauthorized' ? (
        <Link to="/login" className="min-h-[44px] inline-flex items-center rounded px-3 font-medium underline">
          Sign in
        </Link>
      ) : (
        <button type="button" onClick={onRetry} className="min-h-[44px] rounded px-3 font-medium underline">
          Retry live updates
        </button>
      )}
    </div>
  );
}

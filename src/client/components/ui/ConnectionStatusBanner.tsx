import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

/**
 * Global connection status banner for offline resilience (#138).
 * Shows truthful offline state and pending operations count.
 * Positioned at top of viewport with slide-down animation.
 */
export default function ConnectionStatusBanner({
  pendingCount,
  className = '',
}: {
  pendingCount: number;
  className?: string;
}) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setShowReconnected(true);
        const timer = setTimeout(() => setShowReconnected(false), 5000);
        return () => clearTimeout(timer);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [wasOffline]);

  if (isOnline && !showReconnected && pendingCount === 0) {
    return null;
  }

  const variant = isOnline
    ? showReconnected
      ? 'success'
      : 'warning'
    : 'error';

  const bgClass =
    variant === 'success'
      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-950 dark:text-emerald-100'
      : variant === 'warning'
        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-950 dark:text-amber-100'
        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-950 dark:text-rose-100';

  const Icon = isOnline ? Wifi : WifiOff;

  let message = '';
  if (!isOnline) {
    message =
      pendingCount === 0
        ? 'Offline. Changes will sync when connection returns.'
        : `Offline. ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} will sync when connection returns.`;
  } else if (showReconnected) {
    message =
      pendingCount === 0
        ? 'Back online. All changes synced.'
        : `Back online. Syncing ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'}...`;
  } else if (pendingCount > 0) {
    message = `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} pending sync`;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`fixed top-0 left-0 right-0 z-40 animate-slide-down ${className}`}
    >
      <div
        className={`flex items-center gap-3 border-b px-4 py-3 text-sm font-medium shadow-sm ${bgClass}`}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{message}</span>
      </div>
    </div>
  );
}

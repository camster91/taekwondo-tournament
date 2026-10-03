// Top-bar bell (#17). Shows things that need attention, computed by
// GET /api/notifications from existing data: new registrations, the
// waitlist, staffing gaps near the tournament day, your own staff jobs,
// and (for admins/directors) open support requests and invite problems.
// The red badge counts items that changed since the panel was last opened
// (remembered in localStorage, per user).
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCircle2 } from 'lucide-react';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import {
  countUnread,
  isUnread,
  nextLastSeen,
  readLastSeen,
  unreadBadgeText,
  writeLastSeen,
} from '../utils/notifications-seen';

interface AppNotification {
  id: string;
  kind: string;
  title: string;
  detail: string;
  href: string;
  at: string;
  tone: 'info' | 'warning' | 'danger';
}

const toneDot: Record<AppNotification['tone'], string> = {
  info: 'bg-primary-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

function whenText(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '';
  if (diff < 0) return 'Coming up';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(() => (userId ? readLastSeen(userId) : null));
  // What was "seen" before this opening, so new items stay marked while open.
  const [seenBeforeOpen, setSeenBeforeOpen] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();

  useEffect(() => {
    setLastSeen(userId ? readLastSeen(userId) : null);
  }, [userId]);

  const { data, isLoading, isError, refetch } = useQuery<{ notifications: AppNotification[] }>({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      const res = await fetch('/api/notifications', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load notifications');
      return res.json();
    },
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const items = data?.notifications ?? [];
  const unread = countUnread(items, lastSeen);

  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const toggle = () => {
    if (open) return close();
    setSeenBeforeOpen(lastSeen);
    const next = nextLastSeen(items, lastSeen);
    if (next && next !== lastSeen) {
      writeLastSeen(userId, next);
      setLastSeen(next);
    }
    setOpen(true);
    void refetch();
  };

  // While open, anything that arrives is shown, so it counts as seen too.
  useEffect(() => {
    if (!open) return;
    const next = nextLastSeen(items, lastSeen);
    if (next && next !== lastSeen) {
      writeLastSeen(userId, next);
      setLastSeen(next);
    }
  }, [open, items, lastSeen, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!user) return null;

  const label = unread > 0 ? `Notifications, ${unread} new` : 'Notifications';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="relative p-2 text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white rounded-md hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        aria-label={label}
        title="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold leading-[1.1rem] text-center"
          >
            {unreadBadgeText(unread)}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          data-testid="notifications-panel"
          role="dialog"
          aria-labelledby={headingId}
          className="fixed left-2 right-2 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 z-40 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800">
            <h2 id={headingId} className="text-sm font-semibold text-surface-900 dark:text-white">Notifications</h2>
            <button
              type="button"
              onClick={() => close(true)}
              className="text-xs text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white px-2 py-1 rounded"
            >
              Close
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-6 text-sm text-surface-600 dark:text-surface-400" aria-live="polite">Loading…</p>
            ) : isError ? (
              <div className="px-4 py-6 text-sm text-surface-700 dark:text-surface-300" role="alert">
                Notifications could not be loaded.{' '}
                <button type="button" onClick={() => void refetch()} className="underline text-primary-600 dark:text-primary-400">
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-surface-600 dark:text-surface-400">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-success" aria-hidden="true" />
                You're all caught up.
              </div>
            ) : (
              <ul className="divide-y divide-surface-100 dark:divide-surface-800">
                {items.map((item) => {
                  const fresh = isUnread(item, seenBeforeOpen);
                  return (
                    <li key={item.id}>
                      <Link
                        to={item.href}
                        onClick={() => close()}
                        className="flex gap-3 px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/60 focus:bg-surface-50 dark:focus:bg-surface-800/60"
                      >
                        <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${toneDot[item.tone]}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-surface-900 dark:text-white">
                            {item.title}
                            {fresh && (
                              <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                                New
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-surface-600 dark:text-surface-400">{item.detail}</span>
                          <span className="block text-[11px] text-surface-500 dark:text-surface-500">{whenText(item.at)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

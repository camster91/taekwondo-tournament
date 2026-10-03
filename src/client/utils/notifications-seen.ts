// Read state for the top-bar bell (#17). The server computes the list on
// each request and stores nothing, so "unread" is decided here: we remember
// (per user, in localStorage) the newest item time the user has seen and
// count items that changed after it. Losing the entry only means every
// current item shows as new once.

export interface SeenItem {
  at: string;
}

const KEY_PREFIX = 'bowin_notifications_seen_v1:';

export function readLastSeen(userId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

export function writeLastSeen(userId: string, value: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + userId, value);
  } catch {
    // Presentation state only.
  }
}

export function isUnread(item: SeenItem, lastSeen: string | null): boolean {
  if (!lastSeen) return true;
  const seen = Date.parse(lastSeen);
  if (Number.isNaN(seen)) return true;
  return Date.parse(item.at) > seen;
}

export function countUnread(items: SeenItem[], lastSeen: string | null): number {
  return items.filter((item) => isUnread(item, lastSeen)).length;
}

/**
 * The value to store after the panel is opened: the newest item time (so a
 * client clock that runs ahead of the server cannot hide later items), or
 * the previous value when there is nothing newer.
 */
export function nextLastSeen(items: SeenItem[], lastSeen: string | null): string | null {
  let newest = lastSeen && !Number.isNaN(Date.parse(lastSeen)) ? lastSeen : null;
  for (const item of items) {
    if (Number.isNaN(Date.parse(item.at))) continue;
    if (!newest || Date.parse(item.at) > Date.parse(newest)) newest = item.at;
  }
  return newest;
}

/** Badge text: exact up to 9, then "9+". */
export function unreadBadgeText(count: number): string {
  return count > 9 ? '9+' : String(count);
}

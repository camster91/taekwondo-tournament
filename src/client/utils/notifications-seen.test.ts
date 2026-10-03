import { describe, expect, it } from 'vitest';
import { countUnread, isUnread, nextLastSeen, unreadBadgeText } from './notifications-seen';

const items = [
  { at: '2026-10-03T10:00:00.000Z' },
  { at: '2026-10-02T10:00:00.000Z' },
  { at: '2026-10-01T10:00:00.000Z' },
];

describe('notification read state', () => {
  it('treats everything as unread before the panel was ever opened', () => {
    expect(countUnread(items, null)).toBe(3);
    expect(countUnread(items, 'garbage')).toBe(3);
  });

  it('counts only items changed after the last seen time', () => {
    expect(countUnread(items, '2026-10-02T10:00:00.000Z')).toBe(1);
    expect(isUnread(items[1], '2026-10-02T10:00:00.000Z')).toBe(false);
    expect(countUnread(items, '2026-10-04T00:00:00.000Z')).toBe(0);
  });

  it('remembers the newest item time, never moving backwards', () => {
    expect(nextLastSeen(items, null)).toBe('2026-10-03T10:00:00.000Z');
    expect(nextLastSeen(items, '2026-10-05T00:00:00.000Z')).toBe('2026-10-05T00:00:00.000Z');
    expect(nextLastSeen([], null)).toBeNull();
    expect(nextLastSeen([{ at: 'nope' }], '2026-10-01T00:00:00.000Z')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('caps the badge text', () => {
    expect(unreadBadgeText(3)).toBe('3');
    expect(unreadBadgeText(9)).toBe('9');
    expect(unreadBadgeText(12)).toBe('9+');
  });
});

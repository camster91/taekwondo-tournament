import { describe, expect, it, vi } from 'vitest';
import { purgeOfflineOwnerData } from './offline-owner-data.js';

describe('offline owner data purge', () => {
  it('purges venue snapshots and queued mutations for only the departing owner', () => {
    const venue = { clearOwner: vi.fn() };
    const queue = { removeOwner: vi.fn() };
    purgeOfflineOwnerData('owner-a', venue, queue);
    expect(venue.clearOwner).toHaveBeenCalledWith('owner-a');
    expect(queue.removeOwner).toHaveBeenCalledWith('owner-a');
  });
});

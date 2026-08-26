import { describe, expect, it } from 'vitest';
import { buildCheckInRequestPayload, shouldQueueOfflineMutation } from './offline-delivery.js';

describe('offline delivery classification', () => {
  it('queues without attempting when the authenticated session is already offline', () => {
    expect(shouldQueueOfflineMutation({ isOfflineSession: true, navigatorOnline: true })).toBe(true);
    expect(shouldQueueOfflineMutation({ isOfflineSession: false, navigatorOnline: false })).toBe(true);
    expect(shouldQueueOfflineMutation({ isOfflineSession: false, navigatorOnline: true })).toBe(false);
  });

  it('omits an absent optional weigh-in value from the server payload', () => {
    expect(buildCheckInRequestPayload()).toEqual({ checkedIn: true });
    expect(buildCheckInRequestPayload(142.5)).toEqual({ checkedIn: true, checkInWeight: 142.5 });
  });
});

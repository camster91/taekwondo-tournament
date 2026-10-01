import { describe, expect, it } from 'vitest';
import {
  buildCheckInRequestPayload,
  buildUndoCheckInRequestPayload,
  describeCheckInFailure,
  shouldQueueOfflineMutation,
} from './offline-delivery.js';

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

  it('bulk check-in without a weigh-in sends the same payload as a single check-in (no null weight)', () => {
    expect(buildCheckInRequestPayload(undefined)).not.toHaveProperty('checkInWeight');
  });

  it('undo clears the weigh-in explicitly', () => {
    expect(buildUndoCheckInRequestPayload()).toEqual({ checkedIn: false, checkInWeight: null });
  });

  it('shows the server message unless the request never reached the server', () => {
    const fallback = 'Check the venue connection.';
    expect(describeCheckInFailure(new TypeError('Failed to fetch'), fallback)).toBe(fallback);
    expect(describeCheckInFailure(new Error('Insufficient tournament permissions'), fallback)).toBe('Insufficient tournament permissions');
    expect(describeCheckInFailure(new Error(''), fallback)).toBe(fallback);
    expect(describeCheckInFailure('weird', fallback)).toBe(fallback);
  });
});

import { describe, expect, it } from 'vitest';
import { buildDeliveryUncertainMessage, buildOfflineOperationStatuses, buildOfflineReviewMessage, pendingOfflineTargetIds } from './offline-operation-status.js';
import type { OfflineOperation } from './offline-operation-queue.js';

describe('offline operation status presentation', () => {
  it('leaves rejected detail to the per-operation alerts', () => {
    expect(buildOfflineOperationStatuses('result', 0, 1, false)).toEqual([]);
  });

  it('keeps retrying and rejected work visible as separate states', () => {
    expect(buildOfflineOperationStatuses('check-in', 2, 1, true)).toEqual([
      { state: 'retrying', message: '2 check-ins pending sync' },
    ]);
  });

  it('explains which rejected operation failed and why', () => {
    expect(buildOfflineReviewMessage('result', '12345678-abcd', '409 Match changed on the server', {
      label: 'Match 7 · Alex Kim vs Jordan Lee',
      attempted: 'Alex Kim, 8–5',
      createdAt: '2026-08-09T14:30:00.000Z',
    })).toBe(
      'Match 7 · Alex Kim vs Jordan Lee was rejected by server: 409 Match changed on the server. Attempted: Alex Kim, 8–5. Staged Aug 9, 10:30 AM. Review the current match state, then retry or discard this local result.',
    );
    expect(buildOfflineReviewMessage('check-in', '87654321-abcd')).toBe(
      'Check-in #87654321 was rejected by server: Server did not accept the change. Review the current registration state, then retry or discard this local check-in.',
    );
  });

  it('suppresses server work only while the local operation is pending', () => {
    const base = {
      kind: 'score_result', ownerId: 'owner-1', tournamentId: 'tournament-1', createdAt: '2026-08-09T00:00:00.000Z', payload: {},
    } as const;
    const operations: OfflineOperation[] = [
      { ...base, id: 'pending', targetId: 'match-pending', status: 'pending' },
      { ...base, id: 'rejected', targetId: 'match-rejected', status: 'needs_review', lastError: '409 Conflict' },
    ];

    expect([...pendingOfflineTargetIds(operations, 'score_result')]).toEqual(['match-pending']);
  });

  it('warns that delivery-uncertain work must be reconciled instead of retried', () => {
    expect(buildDeliveryUncertainMessage('result', 'Match 7 · Alex Kim vs Jordan Lee')).toBe(
      'Match 7 · Alex Kim vs Jordan Lee may already be saved on the server (network timeout). Refresh to verify the current match state before discarding this local copy. Retry is disabled to prevent duplicates.',
    );
  });
});

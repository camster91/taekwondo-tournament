import { describe, it, expect } from 'vitest';
import {
  buildOfflineReviewMessage,
  buildDeliveryUncertainMessage,
  buildOfflineOperationStatuses,
  pendingOfflineTargetIds,
} from './offline-operation-status';
import type { OfflineOperation } from './offline-operation-queue';

describe('offline resilience (#138)', () => {
  describe('buildOfflineReviewMessage', () => {
    it('builds clear rejection message for match results', () => {
      const message = buildOfflineReviewMessage(
        'result',
        'match-123',
        'Competitor not found',
        {
          label: 'Match 5 (Round 2)',
          attempted: 'Winner: Alice (10-8)',
          createdAt: '2026-09-10T10:30:00Z',
        },
      );

      expect(message).toContain('Match 5 (Round 2)');
      expect(message).toContain('rejected by server');
      expect(message).toContain('Competitor not found');
      expect(message).toContain('Attempted: Winner: Alice (10-8)');
      expect(message).toContain('Review the current match state');
    });

    it('builds clear rejection message for check-in', () => {
      const message = buildOfflineReviewMessage(
        'check-in',
        'reg-456',
        'Weight required for sparring',
        {
          label: 'Alice Smith',
          attempted: 'Checked in at 125 lbs',
          createdAt: '2026-09-10T11:00:00Z',
        },
      );

      expect(message).toContain('Alice Smith');
      expect(message).toContain('rejected by server');
      expect(message).toContain('Weight required for sparring');
      expect(message).toContain('Attempted: Checked in at 125 lbs');
      expect(message).toContain('Review the current registration state');
    });

    it('uses fallback when no error reason provided', () => {
      const message = buildOfflineReviewMessage('result', 'match-123');
      expect(message).toContain('Server did not accept the change');
    });

    it('includes short ID when no label provided', () => {
      const message = buildOfflineReviewMessage('result', 'match-12345678-long-id');
      expect(message).toContain('Result #match-12');
    });
  });

  describe('buildDeliveryUncertainMessage', () => {
    it('explains network timeout for results', () => {
      const message = buildDeliveryUncertainMessage('result', 'Match 5');
      
      expect(message).toContain('Match 5');
      expect(message).toContain('may already be saved on the server');
      expect(message).toContain('network timeout');
      expect(message).toContain('Refresh to verify');
      expect(message).toContain('Retry is disabled to prevent duplicates');
    });

    it('explains network timeout for check-in', () => {
      const message = buildDeliveryUncertainMessage('check-in', 'Alice Smith');
      
      expect(message).toContain('Alice Smith');
      expect(message).toContain('may already be saved on the server');
      expect(message).toContain('registration state');
      expect(message).toContain('prevent duplicates');
    });
  });

  describe('buildOfflineOperationStatuses', () => {
    it('builds queued status when pending and not syncing', () => {
      const statuses = buildOfflineOperationStatuses('result', 3, 0, false);
      
      expect(statuses).toHaveLength(1);
      expect(statuses[0].state).toBe('queued');
      expect(statuses[0].message).toBe('3 results pending sync');
    });

    it('builds retrying status when pending and syncing', () => {
      const statuses = buildOfflineOperationStatuses('result', 2, 0, true);
      
      expect(statuses).toHaveLength(1);
      expect(statuses[0].state).toBe('retrying');
      expect(statuses[0].message).toBe('2 results pending sync');
    });

    it('handles singular form', () => {
      const statuses = buildOfflineOperationStatuses('check-in', 1, 0, false);
      
      expect(statuses[0].message).toBe('1 check-in pending sync');
    });

    it('returns empty array when no pending operations', () => {
      const statuses = buildOfflineOperationStatuses('result', 0, 0, false);
      
      expect(statuses).toHaveLength(0);
    });
  });

  describe('pendingOfflineTargetIds', () => {
    it('extracts target IDs for pending operations of specified kind', () => {
      const operations: OfflineOperation[] = [
        {
          id: 'user1:score_result:match-1',
          kind: 'score_result',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'match-1',
          payload: {},
          createdAt: '2026-09-10T10:00:00Z',
          status: 'pending',
        },
        {
          id: 'user1:score_result:match-2',
          kind: 'score_result',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'match-2',
          payload: {},
          createdAt: '2026-09-10T10:01:00Z',
          status: 'pending',
        },
        {
          id: 'user1:check_in:reg-1',
          kind: 'check_in',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'reg-1',
          payload: {},
          createdAt: '2026-09-10T10:02:00Z',
          status: 'pending',
        },
        {
          id: 'user1:score_result:match-3',
          kind: 'score_result',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'match-3',
          payload: {},
          createdAt: '2026-09-10T10:03:00Z',
          status: 'needs_review',
        },
      ];

      const pendingMatchIds = pendingOfflineTargetIds(operations, 'score_result');
      
      expect(pendingMatchIds.size).toBe(2);
      expect(pendingMatchIds.has('match-1')).toBe(true);
      expect(pendingMatchIds.has('match-2')).toBe(true);
      expect(pendingMatchIds.has('match-3')).toBe(false); // needs_review, not pending
    });

    it('filters by kind correctly', () => {
      const operations: OfflineOperation[] = [
        {
          id: 'user1:check_in:reg-1',
          kind: 'check_in',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'reg-1',
          payload: {},
          createdAt: '2026-09-10T10:00:00Z',
          status: 'pending',
        },
        {
          id: 'user1:check_in:reg-2',
          kind: 'check_in',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'reg-2',
          payload: {},
          createdAt: '2026-09-10T10:01:00Z',
          status: 'pending',
        },
      ];

      const pendingCheckInIds = pendingOfflineTargetIds(operations, 'check_in');
      
      expect(pendingCheckInIds.size).toBe(2);
      expect(pendingCheckInIds.has('reg-1')).toBe(true);
      expect(pendingCheckInIds.has('reg-2')).toBe(true);
    });

    it('returns empty set when no pending operations of that kind', () => {
      const operations: OfflineOperation[] = [
        {
          id: 'user1:score_result:match-1',
          kind: 'score_result',
          ownerId: 'user1',
          tournamentId: 'tournament-1',
          targetId: 'match-1',
          payload: {},
          createdAt: '2026-09-10T10:00:00Z',
          status: 'needs_review',
        },
      ];

      const pendingMatchIds = pendingOfflineTargetIds(operations, 'score_result');
      
      expect(pendingMatchIds.size).toBe(0);
    });
  });

  describe('offline queue behavior - truthful messaging', () => {
    it('never claims definite success without server confirmation', () => {
      // delivery_uncertain status must never show definite success
      const uncertainMessage = buildDeliveryUncertainMessage('result', 'Match 5');
      
      // Should qualify with "may" or "might", never claim definite save
      expect(uncertainMessage.toLowerCase()).toContain('may');
      expect(uncertainMessage.toLowerCase()).not.toContain('successfully saved');
      expect(uncertainMessage.toLowerCase()).not.toContain('save complete');
    });

    it('clearly distinguishes rejected vs uncertain states', () => {
      const rejectedMessage = buildOfflineReviewMessage('result', 'match-1', 'Invalid winner');
      const uncertainMessage = buildDeliveryUncertainMessage('result', 'Match 1');

      expect(rejectedMessage).toContain('rejected by server');
      expect(rejectedMessage).toContain('Invalid winner');
      
      expect(uncertainMessage).toContain('may already be saved');
      expect(uncertainMessage).toContain('network timeout');
      expect(uncertainMessage).not.toContain('rejected');
    });

    it('explains retry prevention for uncertain deliveries', () => {
      const message = buildDeliveryUncertainMessage('check-in', 'Alice');
      
      expect(message).toContain('Retry is disabled');
      expect(message).toContain('prevent duplicates');
    });

    it('guides user to refresh and verify before action', () => {
      const resultMessage = buildDeliveryUncertainMessage('result', 'Match 5');
      const checkInMessage = buildDeliveryUncertainMessage('check-in', 'Alice');

      expect(resultMessage).toContain('Refresh to verify');
      expect(resultMessage).toContain('match state');
      
      expect(checkInMessage).toContain('Refresh to verify');
      expect(checkInMessage).toContain('registration state');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  getAsyncStateLabel,
  getAsyncStateVariant,
  canRetry,
  isOperationInProgress,
  getAsyncStateMessage,
  getMutationStateLabel,
  getMutationStateVariant,
  shouldBlockNavigationForMutation,
  canRetryMutation,
  getMutationBeforeUnloadMessage,
  getEmptyStateMessage,
  getListErrorMessage,
  type AsyncState,
  type AsyncOperationState,
  type MutationState,
  type ListState,
} from './async-state';

describe('async-state utilities', () => {
  describe('getAsyncStateLabel', () => {
    it('returns correct labels for all states', () => {
      expect(getAsyncStateLabel('idle')).toBe('Ready');
      expect(getAsyncStateLabel('loading')).toBe('Loading...');
      expect(getAsyncStateLabel('success')).toBe('Loaded');
      expect(getAsyncStateLabel('error')).toBe('Failed to load');
      expect(getAsyncStateLabel('offline')).toBe('Offline');
      expect(getAsyncStateLabel('retrying')).toBe('Retrying...');
    });
  });

  describe('getAsyncStateVariant', () => {
    it('returns correct variants for all states', () => {
      expect(getAsyncStateVariant('idle')).toBe('default');
      expect(getAsyncStateVariant('loading')).toBe('info');
      expect(getAsyncStateVariant('success')).toBe('success');
      expect(getAsyncStateVariant('error')).toBe('error');
      expect(getAsyncStateVariant('offline')).toBe('warning');
      expect(getAsyncStateVariant('retrying')).toBe('info');
    });
  });

  describe('canRetry', () => {
    it('returns true for error and offline states', () => {
      expect(canRetry('error')).toBe(true);
      expect(canRetry('offline')).toBe(true);
    });

    it('returns false for other states', () => {
      expect(canRetry('idle')).toBe(false);
      expect(canRetry('loading')).toBe(false);
      expect(canRetry('success')).toBe(false);
      expect(canRetry('retrying')).toBe(false);
    });
  });

  describe('isOperationInProgress', () => {
    it('returns true for loading and retrying states', () => {
      expect(isOperationInProgress('loading')).toBe(true);
      expect(isOperationInProgress('retrying')).toBe(true);
    });

    it('returns false for other states', () => {
      expect(isOperationInProgress('idle')).toBe(false);
      expect(isOperationInProgress('success')).toBe(false);
      expect(isOperationInProgress('error')).toBe(false);
      expect(isOperationInProgress('offline')).toBe(false);
    });
  });

  describe('getAsyncStateMessage', () => {
    it('returns empty string for idle state', () => {
      const state: AsyncOperationState = { state: 'idle' };
      expect(getAsyncStateMessage(state)).toBe('');
    });

    it('returns loading message with resource name', () => {
      const state: AsyncOperationState = { state: 'loading' };
      expect(getAsyncStateMessage(state, { resourceName: 'competitors' }))
        .toBe('Loading competitors...');
    });

    it('returns success message with capitalized resource', () => {
      const state: AsyncOperationState = { state: 'success' };
      expect(getAsyncStateMessage(state, { resourceName: 'divisions' }))
        .toBe('Divisions loaded successfully');
    });

    it('returns custom error message when provided', () => {
      const state: AsyncOperationState = {
        state: 'error',
        error: 'Network timeout',
      };
      expect(getAsyncStateMessage(state)).toBe('Network timeout');
    });

    it('returns default error message when not provided', () => {
      const state: AsyncOperationState = { state: 'error' };
      expect(getAsyncStateMessage(state, { resourceName: 'brackets', action: 'generate' }))
        .toBe('Failed to generate brackets. Please try again.');
    });

    it('returns offline message with context', () => {
      const state: AsyncOperationState = { state: 'offline' };
      expect(getAsyncStateMessage(state, { resourceName: 'scores', action: 'save' }))
        .toBe('Cannot save scores while offline. Changes will sync when connection returns.');
    });

    it('returns retrying message with attempt count', () => {
      const state: AsyncOperationState = { state: 'retrying', retryCount: 2 };
      expect(getAsyncStateMessage(state)).toBe('Retrying (attempt 2)...');
    });

    it('returns retrying message without count when not provided', () => {
      const state: AsyncOperationState = { state: 'retrying' };
      expect(getAsyncStateMessage(state)).toBe('Retrying...');
    });
  });

  describe('mutation state helpers', () => {
    describe('getMutationStateLabel', () => {
      it('returns correct labels for all mutation states', () => {
        expect(getMutationStateLabel('idle')).toBe('No changes');
        expect(getMutationStateLabel('dirty')).toBe('Unsaved changes');
        expect(getMutationStateLabel('saving')).toBe('Saving...');
        expect(getMutationStateLabel('saved')).toBe('Saved');
        expect(getMutationStateLabel('error')).toBe('Save failed');
        expect(getMutationStateLabel('offline')).toBe('Offline - will sync later');
        expect(getMutationStateLabel('retrying')).toBe('Retrying save...');
      });
    });

    describe('getMutationStateVariant', () => {
      it('returns correct variants for all mutation states', () => {
        expect(getMutationStateVariant('idle')).toBe('default');
        expect(getMutationStateVariant('dirty')).toBe('warning');
        expect(getMutationStateVariant('saving')).toBe('info');
        expect(getMutationStateVariant('saved')).toBe('success');
        expect(getMutationStateVariant('error')).toBe('error');
        expect(getMutationStateVariant('offline')).toBe('warning');
        expect(getMutationStateVariant('retrying')).toBe('info');
      });
    });

    describe('shouldBlockNavigationForMutation', () => {
      it('returns true for states that should block navigation', () => {
        expect(shouldBlockNavigationForMutation('dirty')).toBe(true);
        expect(shouldBlockNavigationForMutation('saving')).toBe(true);
        expect(shouldBlockNavigationForMutation('retrying')).toBe(true);
      });

      it('returns false for states that should not block', () => {
        expect(shouldBlockNavigationForMutation('idle')).toBe(false);
        expect(shouldBlockNavigationForMutation('saved')).toBe(false);
        expect(shouldBlockNavigationForMutation('error')).toBe(false);
        expect(shouldBlockNavigationForMutation('offline')).toBe(false);
      });
    });

    describe('canRetryMutation', () => {
      it('returns true only for error state', () => {
        expect(canRetryMutation('error')).toBe(true);
      });

      it('returns false for other states', () => {
        expect(canRetryMutation('idle')).toBe(false);
        expect(canRetryMutation('dirty')).toBe(false);
        expect(canRetryMutation('saving')).toBe(false);
        expect(canRetryMutation('saved')).toBe(false);
        expect(canRetryMutation('offline')).toBe(false);
        expect(canRetryMutation('retrying')).toBe(false);
      });
    });

    describe('getMutationBeforeUnloadMessage', () => {
      it('returns message for dirty state', () => {
        expect(getMutationBeforeUnloadMessage('dirty'))
          .toBe('You have unsaved changes. Are you sure you want to leave?');
      });

      it('returns message for saving state', () => {
        expect(getMutationBeforeUnloadMessage('saving'))
          .toBe('Save in progress. Leaving now may lose your changes.');
      });

      it('returns message for retrying state', () => {
        expect(getMutationBeforeUnloadMessage('retrying'))
          .toBe('Save in progress. Leaving now may lose your changes.');
      });

      it('returns undefined for other states', () => {
        expect(getMutationBeforeUnloadMessage('idle')).toBeUndefined();
        expect(getMutationBeforeUnloadMessage('saved')).toBeUndefined();
        expect(getMutationBeforeUnloadMessage('error')).toBeUndefined();
        expect(getMutationBeforeUnloadMessage('offline')).toBeUndefined();
      });
    });
  });

  describe('list state helpers', () => {
    describe('getEmptyStateMessage', () => {
      it('returns filtered message when list is filtered', () => {
        const state: ListState = {
          loading: false,
          isEmpty: true,
          isFiltered: true,
          retrying: false,
        };
        const message = getEmptyStateMessage(state, {
          resourceName: 'tournaments',
          isFiltered: true,
        });
        expect(message).toBe(
          'No tournaments match your filters. Try adjusting your search criteria.'
        );
      });

      it('returns empty message when list is not filtered', () => {
        const state: ListState = {
          loading: false,
          isEmpty: true,
          isFiltered: false,
          retrying: false,
        };
        const message = getEmptyStateMessage(state, {
          resourceName: 'competitors',
          isFiltered: false,
        });
        expect(message).toBe('No competitors yet. Create your first one to get started.');
      });
    });

    describe('getListErrorMessage', () => {
      it('returns custom error when provided', () => {
        const message = getListErrorMessage('Connection failed', 'divisions');
        expect(message).toBe('Connection failed');
      });

      it('returns default error when not provided', () => {
        const message = getListErrorMessage(undefined, 'brackets');
        expect(message).toBe('Failed to load brackets. Please try again.');
      });
    });
  });
});

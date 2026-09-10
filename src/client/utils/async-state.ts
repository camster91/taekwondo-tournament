/**
 * Standardized loading, failure, offline, and retry state management
 * 
 * Extends the SaveState pattern from tournament-settings-state.ts
 * to cover a broader range of async operations across the app.
 */

/**
 * Comprehensive async operation state
 * 
 * - 'idle': No operation in progress
 * - 'loading': Initial load or refresh
 * - 'success': Operation completed successfully
 * - 'error': Operation failed (network, validation, server error)
 * - 'offline': Operation blocked by offline state
 * - 'retrying': Retry attempt in progress
 */
export type AsyncState = 'idle' | 'loading' | 'success' | 'error' | 'offline' | 'retrying';

export interface AsyncOperationState {
  state: AsyncState;
  error?: string;
  retryCount?: number;
  lastSuccessAt?: Date;
}

/**
 * Returns a human-readable label for the async state
 */
export function getAsyncStateLabel(state: AsyncState): string {
  switch (state) {
    case 'idle':
      return 'Ready';
    case 'loading':
      return 'Loading...';
    case 'success':
      return 'Loaded';
    case 'error':
      return 'Failed to load';
    case 'offline':
      return 'Offline';
    case 'retrying':
      return 'Retrying...';
  }
}

/**
 * Returns the visual variant for async state indicators
 */
export function getAsyncStateVariant(
  state: AsyncState
): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (state) {
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'offline':
      return 'warning';
    case 'loading':
    case 'retrying':
      return 'info';
    default:
      return 'default';
  }
}

/**
 * Checks if retry action should be available
 */
export function canRetry(state: AsyncState): boolean {
  return state === 'error' || state === 'offline';
}

/**
 * Checks if the state indicates an operation in progress
 */
export function isOperationInProgress(state: AsyncState): boolean {
  return state === 'loading' || state === 'retrying';
}

/**
 * Returns user-facing message for async states with context
 */
export function getAsyncStateMessage(
  state: AsyncOperationState,
  context?: { resourceName?: string; action?: string }
): string {
  const resource = context?.resourceName || 'data';
  const action = context?.action || 'load';

  switch (state.state) {
    case 'idle':
      return '';
    case 'loading':
      return `Loading ${resource}...`;
    case 'success':
      return `${resource.charAt(0).toUpperCase() + resource.slice(1)} loaded successfully`;
    case 'error':
      return state.error || `Failed to ${action} ${resource}. Please try again.`;
    case 'offline':
      return `Cannot ${action} ${resource} while offline. Changes will sync when connection returns.`;
    case 'retrying':
      const attemptText = state.retryCount ? ` (attempt ${state.retryCount})` : '';
      return `Retrying${attemptText}...`;
  }
}

/**
 * Enhanced mutation state (extends SaveState from tournament-settings-state.ts)
 * 
 * Adds retry and offline handling to the existing save state machine.
 */
export type MutationState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'retrying';

export interface MutationOperationState {
  state: MutationState;
  error?: string;
  retryCount?: number;
}

/**
 * Returns a human-readable label for mutation state
 */
export function getMutationStateLabel(state: MutationState): string {
  switch (state) {
    case 'idle':
      return 'No changes';
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving...';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Save failed';
    case 'offline':
      return 'Offline - will sync later';
    case 'retrying':
      return 'Retrying save...';
  }
}

/**
 * Returns the visual variant for mutation state
 */
export function getMutationStateVariant(
  state: MutationState
): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (state) {
    case 'saved':
      return 'success';
    case 'dirty':
      return 'warning';
    case 'error':
      return 'error';
    case 'offline':
      return 'warning';
    case 'saving':
    case 'retrying':
      return 'info';
    default:
      return 'default';
  }
}

/**
 * Checks if mutation state should block navigation
 */
export function shouldBlockNavigationForMutation(state: MutationState): boolean {
  return state === 'dirty' || state === 'saving' || state === 'retrying';
}

/**
 * Checks if retry is available for mutation state
 */
export function canRetryMutation(state: MutationState): boolean {
  return state === 'error';
}

/**
 * Returns beforeunload message for mutation state
 */
export function getMutationBeforeUnloadMessage(state: MutationState): string | undefined {
  if (state === 'dirty') {
    return 'You have unsaved changes. Are you sure you want to leave?';
  }
  if (state === 'saving' || state === 'retrying') {
    return 'Save in progress. Leaving now may lose your changes.';
  }
  return undefined;
}

/**
 * List state for pages with filtered lists
 */
export interface ListState {
  loading: boolean;
  error?: string;
  retrying: boolean;
  isEmpty: boolean;
  isFiltered: boolean;
}

/**
 * Returns empty state message based on list context
 */
export function getEmptyStateMessage(
  state: ListState,
  context: { resourceName: string; isFiltered: boolean }
): string {
  if (state.isFiltered) {
    return `No ${context.resourceName} match your filters. Try adjusting your search criteria.`;
  }
  return `No ${context.resourceName} yet. Create your first one to get started.`;
}

/**
 * Returns error message for list operations
 */
export function getListErrorMessage(error: string | undefined, resourceName: string): string {
  return error || `Failed to load ${resourceName}. Please try again.`;
}

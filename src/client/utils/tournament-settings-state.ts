/**
 * Save state tracker for settings pages
 * 
 * State machine:
 * - 'clean' → no unsaved changes
 * - 'dirty' → unsaved changes present
 * - 'saving' → save in progress
 * - 'saved' → recently saved (clears after 3s)
 * - 'error' → save failed
 */

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export interface SaveStateManager {
  state: SaveState;
  errorMessage?: string;
}

/**
 * Returns a human-readable label for the save state
 */
export function getSaveStateLabel(state: SaveState): string {
  switch (state) {
    case 'clean':
      return 'No changes';
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving...';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Save failed';
  }
}

/**
 * Returns the visual variant for the save state badge
 */
export function getSaveStateVariant(state: SaveState): 'success' | 'warning' | 'error' | 'default' {
  switch (state) {
    case 'saved':
      return 'success';
    case 'dirty':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
}

/**
 * Checks if unsaved changes should block navigation
 */
export function shouldBlockNavigation(state: SaveState): boolean {
  return state === 'dirty' || state === 'saving';
}

/**
 * Returns the beforeunload message for dirty state
 */
export function getBeforeUnloadMessage(state: SaveState): string | undefined {
  if (state === 'dirty') {
    return 'You have unsaved changes. Are you sure you want to leave?';
  }
  if (state === 'saving') {
    return 'Save in progress. Leaving now may lose your changes.';
  }
  return undefined;
}

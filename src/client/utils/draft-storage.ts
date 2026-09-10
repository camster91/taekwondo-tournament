// Draft storage utilities for recoverable onboarding flows.
// Stores partial form data to localStorage so users can resume
// abandoned org/tournament creation without re-entering data.

const PREFIX = 'bowin_draft_';

export interface DraftOrganization {
  name: string;
  savedAt: number;
}

export interface DraftTournament {
  name: string;
  date: string;
  location: string;
  sportProfileSlug: string;
  savedAt: number;
}

type DraftKey = 'organization' | 'tournament';

function getKey(key: DraftKey): string {
  return `${PREFIX}${key}`;
}

/**
 * Save a draft to localStorage. Silently fails if localStorage unavailable.
 */
export function saveDraft<T extends { savedAt?: number }>(key: DraftKey, data: Omit<T, 'savedAt'>): void {
  try {
    const draft = { ...data, savedAt: Date.now() };
    localStorage.setItem(getKey(key), JSON.stringify(draft));
  } catch {
    // localStorage unavailable or quota exceeded — fail silently
  }
}

/**
 * Load a draft from localStorage. Returns null if not found or expired (>7 days).
 */
export function loadDraft<T extends { savedAt: number }>(key: DraftKey): T | null {
  try {
    const raw = localStorage.getItem(getKey(key));
    if (!raw) return null;
    const draft = JSON.parse(raw) as T;
    const age = Date.now() - draft.savedAt;
    const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (age > MAX_AGE) {
      clearDraft(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/**
 * Clear a draft from localStorage.
 */
export function clearDraft(key: DraftKey): void {
  try {
    localStorage.removeItem(getKey(key));
  } catch {
    // Ignore
  }
}

/**
 * Check if a draft exists without loading it.
 */
export function hasDraft(key: DraftKey): boolean {
  return loadDraft(key) !== null;
}

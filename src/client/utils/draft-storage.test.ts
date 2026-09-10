import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveDraft,
  loadDraft,
  clearDraft,
  hasDraft,
  type DraftOrganization,
  type DraftTournament,
} from './draft-storage';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

globalThis.localStorage = localStorageMock as Storage;

describe('draft-storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllTimers();
  });

  describe('saveDraft', () => {
    it('saves organization draft to localStorage', () => {
      const draft = { name: 'Test Dojo' };
      saveDraft<DraftOrganization>('organization', draft);
      const saved = localStorage.getItem('bowin_draft_organization');
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.name).toBe('Test Dojo');
      expect(parsed.savedAt).toBeTypeOf('number');
    });

    it('saves tournament draft to localStorage', () => {
      const draft = {
        name: 'Spring Championship',
        date: '2026-05-15',
        location: 'City Arena',
        sportProfileSlug: 'taekwondo',
      };
      saveDraft<DraftTournament>('tournament', draft);
      const saved = localStorage.getItem('bowin_draft_tournament');
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.name).toBe('Spring Championship');
      expect(parsed.savedAt).toBeTypeOf('number');
    });

    it('silently fails when localStorage unavailable', () => {
      const setItemSpy = vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => saveDraft('organization', { name: 'Test' })).not.toThrow();
      setItemSpy.mockRestore();
    });
  });

  describe('loadDraft', () => {
    it('loads a saved organization draft', () => {
      const draft = { name: 'Test Dojo' };
      saveDraft<DraftOrganization>('organization', draft);
      const loaded = loadDraft<DraftOrganization>('organization');
      expect(loaded).toBeTruthy();
      expect(loaded!.name).toBe('Test Dojo');
      expect(loaded!.savedAt).toBeTypeOf('number');
    });

    it('returns null when draft does not exist', () => {
      const loaded = loadDraft<DraftOrganization>('organization');
      expect(loaded).toBeNull();
    });

    it('returns null and clears draft when expired (>7 days)', () => {
      const draft = { name: 'Old Draft', savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 };
      localStorage.setItem('bowin_draft_organization', JSON.stringify(draft));
      const loaded = loadDraft<DraftOrganization>('organization');
      expect(loaded).toBeNull();
      expect(localStorage.getItem('bowin_draft_organization')).toBeNull();
    });

    it('returns draft when within 7-day window', () => {
      const draft = { name: 'Recent Draft', savedAt: Date.now() - 6 * 24 * 60 * 60 * 1000 };
      localStorage.setItem('bowin_draft_organization', JSON.stringify(draft));
      const loaded = loadDraft<DraftOrganization>('organization');
      expect(loaded).toBeTruthy();
      expect(loaded!.name).toBe('Recent Draft');
    });

    it('silently returns null when localStorage unavailable', () => {
      const getItemSpy = vi.spyOn(localStorageMock, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const loaded = loadDraft<DraftOrganization>('organization');
      expect(loaded).toBeNull();
      getItemSpy.mockRestore();
    });

    it('returns null when JSON parse fails', () => {
      localStorage.setItem('bowin_draft_organization', 'invalid json');
      const loaded = loadDraft<DraftOrganization>('organization');
      expect(loaded).toBeNull();
    });
  });

  describe('clearDraft', () => {
    it('removes draft from localStorage', () => {
      saveDraft<DraftOrganization>('organization', { name: 'Test' });
      expect(localStorage.getItem('bowin_draft_organization')).toBeTruthy();
      clearDraft('organization');
      expect(localStorage.getItem('bowin_draft_organization')).toBeNull();
    });

    it('silently fails when localStorage unavailable', () => {
      const removeItemSpy = vi.spyOn(localStorageMock, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => clearDraft('organization')).not.toThrow();
      removeItemSpy.mockRestore();
    });
  });

  describe('hasDraft', () => {
    it('returns true when valid draft exists', () => {
      saveDraft<DraftOrganization>('organization', { name: 'Test' });
      expect(hasDraft('organization')).toBe(true);
    });

    it('returns false when no draft exists', () => {
      expect(hasDraft('organization')).toBe(false);
    });

    it('returns false when draft is expired', () => {
      const draft = { name: 'Old', savedAt: Date.now() - 10 * 24 * 60 * 60 * 1000 };
      localStorage.setItem('bowin_draft_organization', JSON.stringify(draft));
      expect(hasDraft('organization')).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isOnboardingCompleted,
  markOnboardingCompleted,
  resetOnboarding,
  detectOnboardingStep,
  parseStepFromUrl,
  setStepInUrl,
  loadOnboardingState,
  shouldShowOnboarding,
  getStepLabel,
  getStepDescription,
  type OnboardingStep,
} from './onboarding-flow';
import { saveDraft, type DraftOrganization } from './draft-storage';

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

// Mock window.location
const locationMock = {
  search: '',
  href: '',
  pathname: '/dashboard',
};

globalThis.window = {
  location: locationMock,
} as unknown as Window & typeof globalThis;

describe('onboarding-flow', () => {
  beforeEach(() => {
    localStorage.clear();
    locationMock.search = '';
  });

  describe('isOnboardingCompleted / markOnboardingCompleted / resetOnboarding', () => {
    it('returns false by default', () => {
      expect(isOnboardingCompleted()).toBe(false);
    });

    it('returns true after marking completed', () => {
      markOnboardingCompleted();
      expect(isOnboardingCompleted()).toBe(true);
    });

    it('resets completion flag', () => {
      markOnboardingCompleted();
      expect(isOnboardingCompleted()).toBe(true);
      resetOnboarding();
      expect(isOnboardingCompleted()).toBe(false);
    });

    it('clears drafts when resetting', () => {
      saveDraft<DraftOrganization>('organization', { name: 'Test' });
      resetOnboarding();
      expect(localStorage.getItem('bowin_draft_organization')).toBeNull();
    });
  });

  describe('detectOnboardingStep', () => {
    it('returns complete when onboarding is marked completed', () => {
      markOnboardingCompleted();
      const step = detectOnboardingStep({
        hasOrganization: false,
        hasTournament: false,
        hasCompetitors: false,
      });
      expect(step).toBe('complete');
    });

    it('returns create-org when user has no organization', () => {
      const step = detectOnboardingStep({
        hasOrganization: false,
        hasTournament: false,
        hasCompetitors: false,
      });
      expect(step).toBe('create-org');
    });

    it('returns first-tournament when org exists but no tournament', () => {
      const step = detectOnboardingStep({
        hasOrganization: true,
        hasTournament: false,
        hasCompetitors: false,
      });
      expect(step).toBe('first-tournament');
    });

    it('returns import-competitors when tournament exists but no competitors', () => {
      const step = detectOnboardingStep({
        hasOrganization: true,
        hasTournament: true,
        hasCompetitors: false,
      });
      expect(step).toBe('import-competitors');
    });

    it('returns review-public-page when all basic setup is complete', () => {
      const step = detectOnboardingStep({
        hasOrganization: true,
        hasTournament: true,
        hasCompetitors: true,
      });
      expect(step).toBe('review-public-page');
    });
  });

  describe('parseStepFromUrl', () => {
    it('parses valid step from URL', () => {
      const step = parseStepFromUrl('?onboarding=create-org');
      expect(step).toBe('create-org');
    });

    it('returns null when no step in URL', () => {
      const step = parseStepFromUrl('?other=param');
      expect(step).toBeNull();
    });

    it('returns null for invalid step', () => {
      const step = parseStepFromUrl('?onboarding=invalid-step');
      expect(step).toBeNull();
    });

    it('handles multiple query params', () => {
      const step = parseStepFromUrl('?foo=bar&onboarding=first-tournament&baz=qux');
      expect(step).toBe('first-tournament');
    });
  });

  describe('setStepInUrl', () => {
    it('sets step in URL', () => {
      const navigate = vi.fn();
      setStepInUrl('create-org', navigate, '/dashboard');
      expect(navigate).toHaveBeenCalledWith('/dashboard?onboarding=create-org');
    });

    it('removes step from URL when passed null', () => {
      const navigate = vi.fn();
      locationMock.search = '?onboarding=create-org';
      setStepInUrl(null, navigate, '/dashboard');
      expect(navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('preserves other query params', () => {
      const navigate = vi.fn();
      locationMock.search = '?foo=bar';
      setStepInUrl('first-tournament', navigate, '/dashboard');
      expect(navigate).toHaveBeenCalledWith(expect.stringContaining('foo=bar'));
      expect(navigate).toHaveBeenCalledWith(expect.stringContaining('onboarding=first-tournament'));
    });
  });

  describe('loadOnboardingState', () => {
    it('loads current onboarding state', () => {
      const state = loadOnboardingState({
        hasOrganization: false,
        hasTournament: false,
        hasCompetitors: false,
        hasReviewedPublicPage: false,
      });
      expect(state.currentStep).toBe('create-org');
      expect(state.hasOrganization).toBe(false);
      expect(state.draftOrganization).toBeNull();
    });

    it('includes draft organization when available', () => {
      saveDraft<DraftOrganization>('organization', { name: 'Test Dojo' });
      const state = loadOnboardingState({
        hasOrganization: false,
        hasTournament: false,
        hasCompetitors: false,
        hasReviewedPublicPage: false,
      });
      expect(state.draftOrganization).toBeTruthy();
      expect(state.draftOrganization!.name).toBe('Test Dojo');
    });
  });

  describe('shouldShowOnboarding', () => {
    it('returns false when onboarding is completed', () => {
      markOnboardingCompleted();
      const result = shouldShowOnboarding({
        hasOrganization: false,
        hasTournament: false,
        isFirstVisit: true,
      });
      expect(result).toBe(false);
    });

    it('returns true when user has no organization', () => {
      const result = shouldShowOnboarding({
        hasOrganization: false,
        hasTournament: false,
        isFirstVisit: false,
      });
      expect(result).toBe(true);
    });

    it('returns true on first visit with no tournament', () => {
      const result = shouldShowOnboarding({
        hasOrganization: true,
        hasTournament: false,
        isFirstVisit: true,
      });
      expect(result).toBe(true);
    });

    it('returns false when user has org and tournament', () => {
      const result = shouldShowOnboarding({
        hasOrganization: true,
        hasTournament: true,
        isFirstVisit: true,
      });
      expect(result).toBe(false);
    });

    it('returns false on repeat visit even with no tournament', () => {
      const result = shouldShowOnboarding({
        hasOrganization: true,
        hasTournament: false,
        isFirstVisit: false,
      });
      expect(result).toBe(false);
    });
  });

  describe('getStepLabel', () => {
    const steps: OnboardingStep[] = [
      'welcome',
      'create-org',
      'first-tournament',
      'import-competitors',
      'review-public-page',
      'complete',
    ];

    steps.forEach((step) => {
      it(`returns label for ${step}`, () => {
        const label = getStepLabel(step);
        expect(label).toBeTruthy();
        expect(typeof label).toBe('string');
      });
    });
  });

  describe('getStepDescription', () => {
    const steps: OnboardingStep[] = [
      'welcome',
      'create-org',
      'first-tournament',
      'import-competitors',
      'review-public-page',
      'complete',
    ];

    steps.forEach((step) => {
      it(`returns description for ${step}`, () => {
        const description = getStepDescription(step);
        expect(description).toBeTruthy();
        expect(typeof description).toBe('string');
      });
    });
  });
});

// Onboarding flow utilities for contextual, recoverable first-run UX.
// Detects new users, tracks progress, manages URL state for step navigation.

import { loadDraft, saveDraft, clearDraft, type DraftOrganization } from './draft-storage';

export type OnboardingStep = 
  | 'welcome'
  | 'create-org'
  | 'first-tournament'
  | 'import-competitors'
  | 'review-public-page'
  | 'complete';

export interface OnboardingState {
  currentStep: OnboardingStep;
  hasOrganization: boolean;
  hasTournament: boolean;
  hasCompetitors: boolean;
  hasReviewedPublicPage: boolean;
  draftOrganization: DraftOrganization | null;
}

const COMPLETED_KEY = 'bowin_onboarding_completed';

/**
 * Check if user has completed the onboarding flow.
 */
export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Mark onboarding as completed.
 */
export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(COMPLETED_KEY, '1');
  } catch {
    // Ignore
  }
}

/**
 * Reset onboarding completion flag (for testing/re-onboarding).
 */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(COMPLETED_KEY);
    clearDraft('organization');
    clearDraft('tournament');
  } catch {
    // Ignore
  }
}

/**
 * Determine the current onboarding step based on user data.
 */
export function detectOnboardingStep(context: {
  hasOrganization: boolean;
  hasTournament: boolean;
  hasCompetitors: boolean;
}): OnboardingStep {
  if (isOnboardingCompleted()) return 'complete';
  if (!context.hasOrganization) return 'create-org';
  if (!context.hasTournament) return 'first-tournament';
  if (!context.hasCompetitors) return 'import-competitors';
  return 'review-public-page';
}

/**
 * Get the URL parameter name for the current step.
 */
export function getStepParam(): string {
  return 'onboarding';
}

/**
 * Parse the onboarding step from URL search params.
 */
export function parseStepFromUrl(search: string): OnboardingStep | null {
  const params = new URLSearchParams(search);
  const step = params.get(getStepParam());
  if (!step) return null;
  const validSteps: OnboardingStep[] = [
    'welcome',
    'create-org',
    'first-tournament',
    'import-competitors',
    'review-public-page',
    'complete',
  ];
  return validSteps.includes(step as OnboardingStep) ? (step as OnboardingStep) : null;
}

/**
 * Set the onboarding step in URL without causing navigation.
 */
export function setStepInUrl(step: OnboardingStep | null, navigate: (path: string) => void, currentPath: string): void {
  const params = new URLSearchParams(window.location.search);
  if (step) {
    params.set(getStepParam(), step);
  } else {
    params.delete(getStepParam());
  }
  const query = params.toString();
  const newPath = query ? `${currentPath}?${query}` : currentPath;
  navigate(newPath);
}

/**
 * Load the current onboarding state.
 */
export function loadOnboardingState(context: {
  hasOrganization: boolean;
  hasTournament: boolean;
  hasCompetitors: boolean;
  hasReviewedPublicPage: boolean;
}): OnboardingState {
  const currentStep = detectOnboardingStep(context);
  const draftOrganization = loadDraft<DraftOrganization>('organization');
  
  return {
    currentStep,
    hasOrganization: context.hasOrganization,
    hasTournament: context.hasTournament,
    hasCompetitors: context.hasCompetitors,
    hasReviewedPublicPage: context.hasReviewedPublicPage,
    draftOrganization,
  };
}

/**
 * Check if we should show the onboarding wizard.
 */
export function shouldShowOnboarding(context: {
  hasOrganization: boolean;
  hasTournament: boolean;
  isFirstVisit: boolean;
}): boolean {
  if (isOnboardingCompleted()) return false;
  // Show onboarding if user has no org, or it's their first visit and they have no tournament
  return !context.hasOrganization || (context.isFirstVisit && !context.hasTournament);
}

/**
 * Get user-friendly label for each step.
 */
export function getStepLabel(step: OnboardingStep): string {
  switch (step) {
    case 'welcome':
      return 'Welcome';
    case 'create-org':
      return 'Create organization';
    case 'first-tournament':
      return 'Create tournament';
    case 'import-competitors':
      return 'Import competitors';
    case 'review-public-page':
      return 'Review public page';
    case 'complete':
      return 'Complete';
  }
}

/**
 * Get brief description for each step.
 */
export function getStepDescription(step: OnboardingStep): string {
  switch (step) {
    case 'welcome':
      return 'Get started with your tournament manager';
    case 'create-org':
      return 'Set up your organization profile';
    case 'first-tournament':
      return 'Create your first tournament';
    case 'import-competitors':
      return 'Add competitors to your roster';
    case 'review-public-page':
      return 'Check your public registration page';
    case 'complete':
      return 'All set up!';
  }
}

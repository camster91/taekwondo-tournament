import { describe, it, expect } from 'vitest';
import {
  getSaveStateLabel,
  getSaveStateVariant,
  shouldBlockNavigation,
  getBeforeUnloadMessage,
  type SaveState,
} from './tournament-settings-state';

describe('tournament-settings-state', () => {
  describe('getSaveStateLabel', () => {
    it('returns correct labels for all states', () => {
      expect(getSaveStateLabel('clean')).toBe('No changes');
      expect(getSaveStateLabel('dirty')).toBe('Unsaved changes');
      expect(getSaveStateLabel('saving')).toBe('Saving...');
      expect(getSaveStateLabel('saved')).toBe('Saved');
      expect(getSaveStateLabel('error')).toBe('Save failed');
    });
  });

  describe('getSaveStateVariant', () => {
    it('returns correct variants for all states', () => {
      expect(getSaveStateVariant('clean')).toBe('default');
      expect(getSaveStateVariant('dirty')).toBe('warning');
      expect(getSaveStateVariant('saving')).toBe('default');
      expect(getSaveStateVariant('saved')).toBe('success');
      expect(getSaveStateVariant('error')).toBe('error');
    });
  });

  describe('shouldBlockNavigation', () => {
    it('blocks navigation for dirty and saving states', () => {
      expect(shouldBlockNavigation('dirty')).toBe(true);
      expect(shouldBlockNavigation('saving')).toBe(true);
    });

    it('does not block navigation for clean, saved, or error states', () => {
      expect(shouldBlockNavigation('clean')).toBe(false);
      expect(shouldBlockNavigation('saved')).toBe(false);
      expect(shouldBlockNavigation('error')).toBe(false);
    });
  });

  describe('getBeforeUnloadMessage', () => {
    it('returns message for dirty state', () => {
      expect(getBeforeUnloadMessage('dirty')).toBe('You have unsaved changes. Are you sure you want to leave?');
    });

    it('returns message for saving state', () => {
      expect(getBeforeUnloadMessage('saving')).toBe('Save in progress. Leaving now may lose your changes.');
    });

    it('returns undefined for clean, saved, and error states', () => {
      expect(getBeforeUnloadMessage('clean')).toBeUndefined();
      expect(getBeforeUnloadMessage('saved')).toBeUndefined();
      expect(getBeforeUnloadMessage('error')).toBeUndefined();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createSessionEvidenceStore } from './session-evidence.js';

describe('session evidence', () => {
  it('does not claim an anonymous first-time visitor had an expired session', () => {
    const storage = new Map<string, string>();
    const evidence = createSessionEvidenceStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });
    expect(evidence.consumeExpiredSessionEvidence()).toBe(false);
  });

  it('reports prior session evidence once, then clears it', () => {
    const storage = new Map<string, string>();
    const evidence = createSessionEvidenceStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });
    evidence.markAuthenticated();
    expect(evidence.consumeExpiredSessionEvidence()).toBe(true);
    expect(evidence.consumeExpiredSessionEvidence()).toBe(false);
  });

  it('fails quietly when storage is unavailable', () => {
    const evidence = createSessionEvidenceStore({
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(() => evidence.markAuthenticated()).not.toThrow();
    expect(evidence.consumeExpiredSessionEvidence()).toBe(false);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeDemoEntryPending,
  findLiveDemoTournament,
  isDemoUser,
  markDemoEntryPending,
  readDemoProgress,
  restartDemoGuide,
  shouldOpenDemoGuide,
  writeDemoProgress,
} from './demo-progress.js';

describe('demo guide progress', () => {
  beforeEach(() => {
    const storage = () => {
      const values = new Map<string, string>();
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => { values.clear(); },
      };
    };
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    localStorage.clear();
    sessionStorage.clear();
  });

  it('uses the explicit server demo marker rather than an email guess', () => {
    expect(isDemoUser({ isDemo: true })).toBe(true);
    expect(isDemoUser({ isDemo: false, email: 'demo-looking@example.com' })).toBe(false);
    expect(isDemoUser(null)).toBe(false);
  });

  it('consumes the login handoff exactly once', () => {
    markDemoEntryPending();
    expect(consumeDemoEntryPending()).toBe(true);
    expect(consumeDemoEntryPending()).toBe(false);
  });

  it('rejects malformed or stale persisted progress', () => {
    localStorage.setItem('bowin.demoGuide.v1.state', '{broken');
    expect(readDemoProgress()).toEqual({ version: 1, status: 'new' });
    localStorage.setItem('bowin.demoGuide.v1.state', JSON.stringify({ version: 2, status: 'completed' }));
    expect(readDemoProgress()).toEqual({ version: 1, status: 'new' });
  });

  it('keeps dismissed and completed distinct and restart clears the last path', () => {
    writeDemoProgress({ version: 1, status: 'dismissed', lastPath: 'director', updatedAt: '2030-01-01T00:00:00.000Z' });
    expect(readDemoProgress().status).toBe('dismissed');
    restartDemoGuide();
    expect(readDemoProgress()).toEqual({ version: 1, status: 'new' });
  });

  it('opens only for demo users who just entered or have never decided', () => {
    expect(shouldOpenDemoGuide({ isDemo: true, pending: true, status: 'completed' })).toBe(true);
    expect(shouldOpenDemoGuide({ isDemo: true, pending: false, status: 'new' })).toBe(true);
    expect(shouldOpenDemoGuide({ isDemo: true, pending: false, status: 'dismissed' })).toBe(false);
    expect(shouldOpenDemoGuide({ isDemo: false, pending: true, status: 'new' })).toBe(false);
  });

  it('resolves the showcase by stable public slug', () => {
    expect(findLiveDemoTournament([
      { id: 'wrong', publicSlug: 'other', status: 'in_progress' },
      { id: 'live', publicSlug: 'bowin-demo-live-championship', status: 'in_progress' },
    ])).toEqual({ id: 'live', publicSlug: 'bowin-demo-live-championship', status: 'in_progress' });
    expect(findLiveDemoTournament([])).toBeNull();
  });
});

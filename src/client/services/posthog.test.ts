/**
 * Tests for the PostHog client init helper (LAUNCH_PLAN.md).
 *
 * Verifies:
 *  - initPostHog is a no-op when VITE_POSTHOG_KEY is unset
 *  - initPostHog calls posthog.init with the configured key + host
 *    when the env var is set
 *  - The privacy-respecting defaults (session recording off, IP off,
 *    identified-only profiles) are applied
 *  - isPostHogEnabled reflects the env var
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
const registerMock = vi.fn();
const captureMock = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: initMock,
    register: registerMock,
    capture: captureMock,
  },
}));

describe('posthog client init', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    initMock.mockClear();
    registerMock.mockClear();
    captureMock.mockClear();
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    consoleInfoSpy.mockRestore();
  });

  it('is a no-op when VITE_POSTHOG_KEY is unset', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    vi.resetModules();

    const { initPostHog, isPostHogEnabled } = await import('./posthog.js');
    initPostHog();

    expect(initMock).not.toHaveBeenCalled();
    expect(isPostHogEnabled()).toBe(false);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('VITE_POSTHOG_KEY not set'),
    );
  });

  it('initializes with the configured key and host', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://eu.i.posthog.com');
    vi.resetModules();

    const { initPostHog, isPostHogEnabled } = await import('./posthog.js');
    initPostHog();

    expect(isPostHogEnabled()).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith(
      'phc_test_key_123',
      expect.objectContaining({ api_host: 'https://eu.i.posthog.com' }),
    );
    // The environment tag is registered for every event.
    expect(registerMock).toHaveBeenCalledWith({ environment: expect.any(String) });
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[posthog] Initialized'),
    );
  });

  it('defaults the host to us.i.posthog.com when VITE_POSTHOG_HOST is unset', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    vi.resetModules();

    const { initPostHog } = await import('./posthog.js');
    initPostHog();

    expect(initMock).toHaveBeenCalledWith(
      'phc_test_key_123',
      expect.objectContaining({ api_host: 'https://us.i.posthog.com' }),
    );
  });

  it('disables session recording to protect minors (privacy default)', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://eu.i.posthog.com');
    vi.resetModules();

    const { initPostHog } = await import('./posthog.js');
    initPostHog();

    expect(initMock).toHaveBeenCalledWith(
      'phc_test_key_123',
      expect.objectContaining({ disable_session_recording: true }),
    );
  });

  it('opts out of IP capture and identified-only profiles (privacy defaults)', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    vi.resetModules();

    const { initPostHog } = await import('./posthog.js');
    initPostHog();

    expect(initMock).toHaveBeenCalledWith(
      'phc_test_key_123',
      expect.objectContaining({
        ip: false,
        person_profiles: 'identified_only',
        mask_all_text: true,
      }),
    );
  });

  it('captures pageviews automatically so the director dashboard has data', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    vi.resetModules();

    const { initPostHog } = await import('./posthog.js');
    initPostHog();

    expect(initMock).toHaveBeenCalledWith(
      'phc_test_key_123',
      expect.objectContaining({
        capture_pageview: true,
        capture_pageleave: true,
      }),
    );
  });
});

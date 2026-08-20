// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MatchTimer from './MatchTimer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MatchTimer controls and shortcut guards', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders 44px min touch target controls with proper ARIA attributes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<MatchTimer defaultRoundTime={120} defaultRounds={2} />);
    });

    const playBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Start timer (Space)"]')!;
    expect(playBtn).not.toBeNull();
    expect(playBtn.getAttribute('type')).toBe('button');

    const muteBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Mute sound"]')!;
    expect(muteBtn).not.toBeNull();
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');

    const settingsBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Timer settings"]')!;
    expect(settingsBtn).not.toBeNull();
    expect(settingsBtn.getAttribute('aria-expanded')).toBe('false');

    // Click settings to expand
    await act(async () => {
      settingsBtn.click();
    });
    expect(settingsBtn.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      root.unmount();
    });
  });

  it('Space shortcut toggles timer when body is focused, but not when a button or dialog is focused', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<MatchTimer defaultRoundTime={120} defaultRounds={2} />);
    });

    // Space on neutral body
    document.body.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    });

    // Timer should now be running
    const pauseBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Pause timer (Space)"]')!;
    expect(pauseBtn).not.toBeNull();

    // Focus on an interactive button
    const testButton = document.createElement('button');
    document.body.appendChild(testButton);
    testButton.focus();

    // Space while focused on testButton should NOT toggle timer again
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    });
    // Should still be running (not paused)
    expect(document.querySelector('button[aria-label="Pause timer (Space)"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('clicking Reset All opens accessible ConfirmDialog instead of window.confirm', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<MatchTimer defaultRoundTime={120} defaultRounds={2} />);
    });

    const resetAllBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Reset entire match timer"]')!;
    expect(resetAllBtn).not.toBeNull();

    await act(async () => {
      resetAllBtn.click();
    });

    // Confirm dialog should be open
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Reset Match Timer');

    await act(async () => {
      root.unmount();
    });
  });
});

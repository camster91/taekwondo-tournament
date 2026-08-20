// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, ToastItem } from './ToastContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ToastContext & ToastItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders status and alert live regions with distinct roles and dismiss labels', async () => {
    function TestConsumer() {
      const { success, error } = useToast();
      return (
        <div>
          <button id="trigger-success" onClick={() => success('Profile updated successfully')}>
            Success
          </button>
          <button id="trigger-error" onClick={() => error('Network connection failed')}>
            Error
          </button>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>
      );
    });

    const successBtn = document.querySelector<HTMLButtonElement>('#trigger-success')!;
    const errorBtn = document.querySelector<HTMLButtonElement>('#trigger-error')!;

    await act(async () => {
      successBtn.click();
      errorBtn.click();
    });

    const statusToast = document.querySelector('[role="status"]');
    const alertToast = document.querySelector('[role="alert"]');

    expect(statusToast).not.toBeNull();
    expect(statusToast?.getAttribute('aria-live')).toBe('polite');
    expect(statusToast?.textContent).toContain('Profile updated successfully');

    expect(alertToast).not.toBeNull();
    expect(alertToast?.getAttribute('aria-live')).toBe('assertive');
    expect(alertToast?.textContent).toContain('Network connection failed');

    const closeButtons = document.querySelectorAll('button[aria-label^="Dismiss notification:"]');
    expect(closeButtons.length).toBe(2);
    expect(closeButtons[0].getAttribute('aria-label')).toContain('Profile updated successfully');
    expect(closeButtons[1].getAttribute('aria-label')).toContain('Network connection failed');

    await act(async () => {
      root.unmount();
    });
  });

  it('pauses timer on focus and resumes on blur', async () => {
    const onRemove = vi.fn();
    const toast = { id: 't1', message: 'Test message', type: 'info' as const, duration: 1000 };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ToastItem toast={toast} onRemove={onRemove} />);
    });

    const dismissButton = document.querySelector<HTMLButtonElement>('button')!;

    // Advance 400ms
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onRemove).not.toHaveBeenCalled();

    // Focus close button inside toast to pause
    act(() => {
      dismissButton.focus();
    });

    // Advance 1000ms while paused — should not fire
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRemove).not.toHaveBeenCalled();

    // Blur to resume
    act(() => {
      dismissButton.blur();
    });

    // Advance remaining 600ms
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onRemove).toHaveBeenCalledWith('t1');

    await act(async () => {
      root.unmount();
    });
  });
});

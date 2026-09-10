// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ConfirmDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('focuses the safe Cancel button first for danger dialogs and connects title/description IDs', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete Tournament"
          message="Are you sure you want to delete this tournament?"
          variant="danger"
        />
      );
    });

    act(() => {
      vi.runAllTimers();
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();

    const titleId = dialog.getAttribute('aria-labelledby');
    const descId = dialog.getAttribute('aria-describedby');
    expect(titleId).toBeTruthy();
    expect(descId).toBeTruthy();

    const titleEl = document.getElementById(titleId!);
    const descEl = document.getElementById(descId!);
    expect(titleEl?.textContent).toContain('Delete Tournament');
    expect(descEl?.textContent).toContain('Are you sure you want to delete this tournament?');

    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-cancel-button]')!;
    expect(document.activeElement).toBe(cancelBtn);

    await act(async () => {
      root.unmount();
    });
  });

  it('focuses the Confirm button first for info dialogs', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Information"
          message="This is an info dialog"
          variant="info"
        />
      );
    });

    act(() => {
      vi.runAllTimers();
    });

    const confirmBtn = document.querySelector<HTMLButtonElement>('[data-confirm-button]')!;
    expect(document.activeElement).toBe(confirmBtn);

    await act(async () => {
      root.unmount();
    });
  });

  it('locks dismissal and sets aria-busy when isLoading is true', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Deleting..."
          message="Please wait"
          isLoading={true}
        />
      );
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-busy')).toBe('true');

    // Press Escape
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    // Click backdrop
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50')!;
    act(() => {
      (backdrop as HTMLElement).click();
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('locks body scroll when open and restores it when closed', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const originalOverflow = document.body.style.overflow;

    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Test"
          message="Test message"
        />
      );
    });

    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen={false}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Test"
          message="Test message"
        />
      );
    });

    expect(document.body.style.overflow).toBe(originalOverflow);

    await act(async () => {
      root.unmount();
    });
  });

  it('focuses Cancel button first for warning variant', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Warning"
          message="This is a warning"
          variant="warning"
        />
      );
    });

    act(() => {
      vi.runAllTimers();
    });

    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-cancel-button]')!;
    expect(document.activeElement).toBe(cancelBtn);

    await act(async () => {
      root.unmount();
    });
  });
});

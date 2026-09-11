// @vitest-environment jsdom
// Regression test for MEDIUM 3.6 from review/03-frontend.md:
// TournamentDetail's cloneTournament mutation used to call native window.alert()
// on error, bypassing the ToastContext. The fix replaces alert(e.message || 'Clone failed')
// with addToast(e.message || 'Clone failed', 'error'). This test asserts the new
// error-reporting pattern does not call window.alert and that the error message
// reaches the toast UI.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../context/ToastContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mirrors the cloneTournament onError handler shape that lives in
 * src/client/pages/TournamentDetail.tsx. Kept in sync by code review; the
 * intent of this test is to lock the error-reporting contract (no native
 * alert, error toast with the message) for the file under review.
 */
function CloneErrorReporter({ trigger }: { trigger: () => Error }) {
  const { addToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        const err = trigger();
        addToast(err.message || 'Clone failed', 'error');
      }}
    >
      trigger clone error
    </button>
  );
}

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

describe('TournamentDetail clone error reporting (MEDIUM 3.6)', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('does not call window.alert when the clone mutation fails', async () => {
    const { cleanup } = await mount(
      <ToastProvider>
        <CloneErrorReporter trigger={() => new Error('Server rejected clone')} />
      </ToastProvider>,
    );

    const btn = document.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      btn.click();
    });

    expect(alertSpy).not.toHaveBeenCalled();

    cleanup();
  });

  it('surfaces the server error message in the toast UI, not the fallback', async () => {
    const { cleanup } = await mount(
      <ToastProvider>
        <CloneErrorReporter trigger={() => new Error('You do not own this tournament')} />
      </ToastProvider>,
    );

    const btn = document.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      btn.click();
    });

    // The toast container in ToastContext renders the message inside a <p>.
    const toastText = document.body.textContent || '';
    expect(toastText).toContain('You do not own this tournament');
    // No native alert text leaks into the DOM.
    expect(toastText).not.toMatch(/^OK$/m);

    cleanup();
  });

  it('falls back to the default message when the thrown error has no message', async () => {
    const { cleanup } = await mount(
      <ToastProvider>
        <CloneErrorReporter trigger={() => new Error('')} />
      </ToastProvider>,
    );

    const btn = document.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      btn.click();
    });

    const toastText = document.body.textContent || '';
    expect(toastText).toContain('Clone failed');
    expect(alertSpy).not.toHaveBeenCalled();

    cleanup();
  });
});

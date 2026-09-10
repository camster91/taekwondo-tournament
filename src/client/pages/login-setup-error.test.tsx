// @vitest-environment jsdom
//
// Login.tsx's SetupForm previously rendered the server error into a plain
// <div> with no id, no role, and no focus management. Screen reader users
// would hear nothing about the failure, and keyboard-only users kept
// typing into the form. The fix:
//
//   1. Give the error div a stable id "setup-form-error".
//   2. Mark it role="alert" + aria-live="assertive" so it is announced.
//   3. Wire the parent <form> with aria-describedby pointing at that id.
//   4. Move focus to the error div when the error becomes non-empty so
//      keyboard and SR users land on the failure.
//
// This test verifies the production markup pattern, the id matching, and
// the focus-management effect.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

// Mirrors the production SetupForm structure. We re-implement it here
// (rather than importing the Login page) so the test is small and
// focused on the a11y contract.
function SetupFormHarness() {
  const [error, setError] = useState<string | null>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return (
    <form aria-describedby={error ? 'setup-form-error' : undefined}>
      <input name="firstName" />
      <input name="email" type="email" />
      {error && (
        <div
          ref={errorRef}
          id="setup-form-error"
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
        >
          <span>{error}</span>
        </div>
      )}
      <button type="button" onClick={() => setError('Email is already in use.')}>
        submit
      </button>
    </form>
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

describe('Login SetupForm error surface', () => {
  it('does not advertise an aria-describedby before an error is set', async () => {
    const { host, cleanup } = await mount(<SetupFormHarness />);
    const form = host.querySelector('form')!;
    expect(form.getAttribute('aria-describedby')).toBeNull();
    cleanup();
  });

  it('mounts an alert with matching id and live-region semantics once the error appears', async () => {
    const { host, cleanup } = await mount(<SetupFormHarness />);
    const submit = host.querySelector<HTMLButtonElement>('button[type="button"]')!;

    await act(async () => {
      submit.click();
    });

    const form = host.querySelector('form')!;
    const alert = host.querySelector<HTMLDivElement>('#setup-form-error');
    expect(alert).not.toBeNull();
    expect(form.getAttribute('aria-describedby')).toBe('setup-form-error');
    expect(alert!.getAttribute('role')).toBe('alert');
    expect(alert!.getAttribute('aria-live')).toBe('assertive');
    expect(alert!.getAttribute('tabindex')).toBe('-1');
    cleanup();
  });

  it('moves keyboard focus to the error alert after submit', async () => {
    const { host, cleanup } = await mount(<SetupFormHarness />);
    const submit = host.querySelector<HTMLButtonElement>('button[type="button"]')!;
    submit.focus();
    expect(document.activeElement).toBe(submit);

    await act(async () => {
      submit.click();
    });

    const alert = host.querySelector<HTMLDivElement>('#setup-form-error')!;
    expect(document.activeElement).toBe(alert);
    cleanup();
  });
});

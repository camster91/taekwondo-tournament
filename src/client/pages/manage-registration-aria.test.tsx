// @vitest-environment jsdom
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

function LookupForm() {
  const [error, setError] = useState<string | null>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return (
    <form aria-describedby={error ? 'lookup-error' : undefined}>
      <button type="submit">Open</button>
      {error && (
        <div
          ref={errorRef}
          id="lookup-error"
          role="alert"
          tabIndex={-1}
        >
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => setError('This management link is invalid or has expired.')}
      >
        trigger error
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

describe('ManageRegistration lookup form a11y', () => {
  it('aria-describedby on the form resolves to the live error element', async () => {
    const { host, cleanup } = await mount(<LookupForm />);

    const form = host.querySelector('form')!;
    expect(form.getAttribute('aria-describedby')).toBeNull();

    const trigger = host.querySelector<HTMLButtonElement>('button[type="button"]')!;
    await act(async () => {
      trigger.click();
    });

    expect(form.getAttribute('aria-describedby')).toBe('lookup-error');
    const target = host.querySelector<HTMLDivElement>('#lookup-error');
    expect(target).not.toBeNull();
    expect(target!.getAttribute('role')).toBe('alert');
    expect(target!.getAttribute('tabindex')).toBe('-1');

    cleanup();
  });

  it('moves keyboard focus to the error alert when an error is set', async () => {
    const { host, cleanup } = await mount(<LookupForm />);

    const trigger = host.querySelector<HTMLButtonElement>('button[type="button"]')!;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      trigger.click();
    });

    const target = host.querySelector<HTMLDivElement>('#lookup-error')!;
    expect(document.activeElement).toBe(target);

    cleanup();
  });
});

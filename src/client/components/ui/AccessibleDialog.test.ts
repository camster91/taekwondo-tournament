// @vitest-environment jsdom
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import AccessibleDialog from './AccessibleDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AccessibleDialog', () => {
  it('moves focus inside, traps Tab, closes on Escape, and restores its opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { id: 'opener', onClick: () => setOpen(true) }, 'Open'),
        open
          ? React.createElement(
              AccessibleDialog,
              { label: 'Confirm result', onClose: () => setOpen(false) },
              React.createElement('button', { id: 'cancel' }, 'Cancel'),
              React.createElement('button', { id: 'confirm' }, 'Confirm'),
            )
          : null,
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(Harness)));
    const opener = document.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    await act(async () => opener.click());

    expect(document.activeElement).toBe(document.querySelector('#cancel'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    document.querySelector<HTMLButtonElement>('#confirm')!.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('#cancel'));

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    root.unmount();
  });
});

// @vitest-environment jsdom
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import AccessibleDialog from '../components/ui/AccessibleDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

function KeyboardHelpModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="help-opener" type="button" onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <AccessibleDialog
            label="Keyboard shortcuts"
            onClose={() => setOpen(false)}
          >
            <h3>Keyboard Shortcuts</h3>
            <button id="shortcut-close" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </AccessibleDialog>
        </div>
      )}
    </>
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

describe('Scorekeeper keyboard-help modal', () => {
  it('closes on Escape and restores focus to the opener', async () => {
    const { host, cleanup } = await mount(<KeyboardHelpModal />);
    const opener = host.querySelector<HTMLButtonElement>('#help-opener')!;
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await act(async () => {
      opener.click();
    });

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(document.activeElement).not.toBe(opener);
    expect(dialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    expect(document.activeElement).toBe(opener);

    cleanup();
  });
});

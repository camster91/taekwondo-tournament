// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { activateDialogFocus } from './dialog-focus';

describe('dialog focus containment', () => {
  it('moves focus inside, wraps Tab, closes on Escape, and restores prior focus', () => {
    document.body.innerHTML = `
      <button id="opener">Open</button>
      <div id="dialog"><button id="first">First</button><button id="last">Last</button></div>
    `;
    const opener = document.querySelector<HTMLElement>('#opener')!;
    const dialog = document.querySelector<HTMLElement>('#dialog')!;
    const first = document.querySelector<HTMLElement>('#first')!;
    const last = document.querySelector<HTMLElement>('#last')!;
    const close = vi.fn();
    const leakedEscape = vi.fn();
    window.addEventListener('keydown', leakedEscape);
    opener.focus();

    const deactivate = activateDialogFocus(dialog, close);
    expect(document.activeElement).toBe(first);

    last.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);

    leakedEscape.mockClear();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledOnce();
    expect(leakedEscape).not.toHaveBeenCalled();

    deactivate();
    expect(document.activeElement).toBe(opener);
    window.removeEventListener('keydown', leakedEscape);
  });
});

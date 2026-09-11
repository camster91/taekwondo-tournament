// @vitest-environment jsdom
// Regression test for MEDIUM 3.9 from review/03-frontend.md:
// CommandPalette is a combobox-like UI but had no role="combobox" / role="listbox"
// / aria-expanded / aria-activedescendant wiring. Screen-reader users could type
// into the search field but had no way to navigate the result list. The fix
// adds the ARIA 1.2 combobox contract (combobox on the wrapper, listbox on the
// results, options with aria-selected, and aria-activedescendant tracking the
// highlighted row).
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Auth is only used for hasRole — supply a minimal stub.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    hasRole: () => true,
    user: null,
  }),
}));

import { CommandPalette } from './CommandPalette';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  return {
    host,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

function Harness({ open = true }: { open?: boolean }) {
  const [isOpen, setIsOpen] = useState(open);
  return <CommandPalette isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

describe('CommandPalette combobox ARIA contract (MEDIUM 3.9)', () => {
  it('renders a combobox wrapper that owns a listbox of commands', async () => {
    const { cleanup } = await mount(<Harness />);

    const combobox = document.querySelector<HTMLElement>('[role="combobox"]')!;
    expect(combobox).not.toBeNull();
    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox');
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    expect(combobox.getAttribute('aria-owns')).toBe('cmdk-list');

    const listbox = document.getElementById('cmdk-list');
    expect(listbox).not.toBeNull();
    expect(listbox!.getAttribute('role')).toBe('listbox');

    cleanup();
  });

  it('wires the search input to the listbox via aria-controls and aria-autocomplete', async () => {
    const { cleanup } = await mount(<Harness />);

    const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-controls')).toBe('cmdk-list');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-label')).toBeTruthy();

    cleanup();
  });

  it('marks every command row as an option with an aria-selected state', async () => {
    const { cleanup } = await mount(<Harness />);

    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    options.forEach((opt) => {
      expect(opt.id).toMatch(/^cmdk-row-\d+$/);
      // aria-selected is always present (true or false), not absent.
      expect(['true', 'false']).toContain(opt.getAttribute('aria-selected'));
    });

    // Exactly one row is selected at any time — the default is index 0.
    const selected = Array.from(options).filter(
      (o) => o.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);

    cleanup();
  });

  it('points aria-activedescendant at the highlighted row so AT users can follow the focus', async () => {
    const { cleanup } = await mount(<Harness />);

    const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    // Default selectedIndex is 0 → first row id.
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk-row-0');

    cleanup();
  });

  it('updates aria-activedescendant when the user navigates with ArrowDown', async () => {
    const { cleanup } = await mount(<Harness />);

    const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk-row-1');

    cleanup();
  });
});

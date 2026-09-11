// @vitest-environment jsdom
// Regression test for MEDIUM 3.8 from review/03-frontend.md:
// react-router-dom's <Link> does not auto-add rel="noopener noreferrer" when
// target="_blank". DirectorDashboard's "Scorekeeper" and "Public Scoreboard"
// tiles opened the destination in a new tab without those attributes, leaving
// the new tab with a window.opener reference (the reverse-tabnabbing setup).
// The fix introduces a SafeLink wrapper that injects the safe defaults whenever
// target="_blank" is set, and the two tiles in DirectorDashboard now use it.
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import SafeLink from './SafeLink';

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

describe('SafeLink (MEDIUM 3.8)', () => {
  it('injects rel="noopener noreferrer" when target="_blank" is set', async () => {
    const { cleanup } = await mount(
      <SafeLink to="/scorekeeper/abc" target="_blank">
        Scorekeeper
      </SafeLink>,
    );

    const a = document.querySelector<HTMLAnchorElement>('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');

    cleanup();
  });

  it('does not add a rel attribute when target is not _blank', async () => {
    const { cleanup } = await mount(
      <SafeLink to="/dashboard">Dashboard</SafeLink>,
    );

    const a = document.querySelector<HTMLAnchorElement>('a')!;
    expect(a.getAttribute('target')).toBeNull();
    expect(a.getAttribute('rel')).toBeNull();

    cleanup();
  });

  it('lets callers override the rel attribute even with target="_blank"', async () => {
    const { cleanup } = await mount(
      <SafeLink to="/external" target="_blank" rel="author">
        External
      </SafeLink>,
    );

    const a = document.querySelector<HTMLAnchorElement>('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    // Caller-provided rel wins, so it does not silently get overwritten with
    // "noopener noreferrer" — the override is intentional and should land.
    expect(a.getAttribute('rel')).toBe('author');

    cleanup();
  });

  it('preserves the underlying <Link> routing behavior (renders an anchor with the correct href)', async () => {
    const { cleanup } = await mount(
      <SafeLink to="/display/xyz" target="_blank">
        Public Scoreboard
      </SafeLink>,
    );

    const a = document.querySelector<HTMLAnchorElement>('a')!;
    expect(a.getAttribute('href')).toBe('/display/xyz');
    expect(a.textContent).toContain('Public Scoreboard');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');

    cleanup();
  });
});

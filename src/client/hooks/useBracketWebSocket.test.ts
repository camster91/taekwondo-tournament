// @vitest-environment jsdom
import { act, createElement, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBracketWebSocket } from './useBracketWebSocket.js';

// React 19 requires this flag for `act(...)` to flush state updates
// outside of `@testing-library/react`. Mirrors the convention from
// `ConfirmDialog.test.tsx`.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// vi.mock is hoisted above the import above. The hook calls
// `queryClient.invalidateQueries` on every bracket message — a
// minimal stub is enough to verify the hook is invoked and to
// keep these tests free of a real QueryClient.
const queryClientStub = {
  invalidateQueries: vi.fn(),
};

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClientStub,
}));

interface FakeWebSocketInstance {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const FakeWebSocketCtor = vi.fn();

function makeFakeWebSocket(url: string): FakeWebSocketInstance {
  return {
    url,
    readyState: 0, // CONNECTING
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: vi.fn(),
    close: vi.fn(),
  };
}

// Minimal localStorage stub. The default jsdom 27 localStorage in
// this vitest 4 setup is missing `clear` / `removeItem` (see the
// `--localstorage-file` warning the suite prints). We don't care
// about persistence — we only need getItem/setItem/removeItem/clear
// so the hook's "does not read localStorage" assertion is meaningful.
const localStorageStub: Storage = (() => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
})();

beforeEach(() => {
  queryClientStub.invalidateQueries.mockReset();
  FakeWebSocketCtor.mockReset();
  FakeWebSocketCtor.mockImplementation(makeFakeWebSocket);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { protocol: 'http:', host: 'localhost:5173', hostname: 'localhost' },
  });
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocketCtor;
  vi.stubGlobal('localStorage', localStorageStub);
  localStorageStub.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

type HookResult = ReturnType<typeof useBracketWebSocket>;

interface HookHarnessProps {
  onResult: (result: HookResult) => void;
  tournamentId: string;
  divisionId: string;
  enabled?: boolean;
  onMatchUpdate?: (id: string, data: unknown) => void;
  onBracketRegenerated?: () => void;
}

function HookHarness({ onResult, ...options }: HookHarnessProps) {
  const result = useBracketWebSocket(options);
  const last = useRef<HookResult | null>(null);
  if (last.current !== result) {
    last.current = result;
  }
  useEffect(() => {
    onResult(result);
    // We intentionally exclude `onResult` from the deps — tests pass
    // a stable callback, and a re-fire on identity change would mask
    // the SH-1 contract (a fresh result object per render is fine,
    // but we want to report on the relevant state transitions).
  }, [result.isConnected, result.connectionError]);
  return null;
}

interface MountedHook {
  getResult: () => HookResult;
  unmount: () => void;
}

function mountHook(options: Omit<HookHarnessProps, 'onResult'>): MountedHook {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let latest: HookResult = {
    isConnected: false,
    connectionError: null,
    reconnect: () => {},
    disconnect: () => {},
  };
  const onResult = (r: HookResult) => {
    latest = r;
  };
  void act(() => {
    root.render(createElement(HookHarness, { ...options, onResult }));
  });
  return {
    getResult: () => latest,
    unmount: () => {
      void act(() => root.unmount());
      host.remove();
    },
  };
}

describe('useBracketWebSocket — SH-1 cookie auth', () => {
  it('does not read the auth token from localStorage', async () => {
    // Plant stale tokens in both legacy keys. If the hook still
    // reads localStorage, those bytes would leak into the URL or
    // trip the old console.warn — both are checked below.
    localStorage.setItem('bowin_session', 'STALE-LEAKED-JWT-FROM-LOCALSTORAGE');
    localStorage.setItem('tkd_auth_token', 'STALE-LEAKED-JWT-FROM-LOCALSTORAGE');

    const harness = mountHook({ tournamentId: 't1', divisionId: 'd1' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(FakeWebSocketCtor).toHaveBeenCalledTimes(1);
    const openedUrl = FakeWebSocketCtor.mock.calls[0]?.[0] as string;
    expect(openedUrl).toBe('ws://localhost:5173/ws/brackets');
    expect(openedUrl).not.toContain('token=');
    expect(openedUrl).not.toContain('STALE-LEAKED');

    expect(harness.getResult().connectionError).toBeNull();
    harness.unmount();
  });

  it('connects to the same-origin /ws/brackets path so the browser auto-attaches the HttpOnly cookie', async () => {
    mountHook({ tournamentId: 't1', divisionId: 'd1' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(FakeWebSocketCtor).toHaveBeenCalledTimes(1);
    const openedUrl = FakeWebSocketCtor.mock.calls[0]?.[0] as string;
    expect(openedUrl.startsWith('ws://localhost:5173/ws/brackets')).toBe(true);
    expect(openedUrl).not.toMatch(/\?/);
  });

  it('surfaces a connection error to the consumer instead of console.warn-only', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const harness = mountHook({ tournamentId: 't1', divisionId: 'd1' });
    await act(async () => {
      await Promise.resolve();
    });
    const ws = FakeWebSocketCtor.mock.results[0]?.value as FakeWebSocketInstance;
    expect(ws).toBeDefined();

    // The browser hides WS error details from JS — the hook must
    // surface a stable message so the consumer can show a banner.
    await act(async () => {
      ws.onerror?.(new Event('error'));
    });

    const result = harness.getResult();
    expect(result.isConnected).toBe(false);
    expect(result.connectionError).toBeTruthy();
    expect(result.connectionError).toMatch(/WebSocket connection error/i);

    expect(consoleError).toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    for (const call of consoleError.mock.calls) {
      const serialized = call.map(String).join(' ');
      expect(serialized).not.toContain('token=');
    }
    harness.unmount();
  });

  it('stops reconnecting after an application-level close (4xxx) and reports it', async () => {
    vi.useFakeTimers();
    const harness = mountHook({ tournamentId: 't1', divisionId: 'd1' });
    await act(async () => {
      await Promise.resolve();
    });
    const ws = FakeWebSocketCtor.mock.results[0]?.value as FakeWebSocketInstance;
    expect(ws).toBeDefined();

    // Simulate the server rejecting our auth — close code 1008.
    await act(async () => {
      ws.onclose?.({ code: 1008, reason: 'Invalid authentication token' });
    });

    const result = harness.getResult();
    expect(result.connectionError).toMatch(/re-authentication/i);

    // No reconnection timer should be scheduled — the SH-1 contract
    // is "surface the failure", not "retry forever with a stale token".
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    const reconnectCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => typeof delay === 'number' && delay >= 1000,
    );
    expect(reconnectCalls).toHaveLength(0);
    setTimeoutSpy.mockRestore();
    harness.unmount();
  });
});

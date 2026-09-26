// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import { bracketSocketUrl, isTerminalCloseCode, useBracketWebSocket } from './useBracketWebSocket';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.serverClose(1000); }

  // Test helpers
  serverOpen() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  serverMessage(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  serverClose(code: number) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason: '' });
  }
}

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe('useBracketWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects to the same-origin endpoint without reading or sending a token', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    renderHook(() => useBracketWebSocket({ tournamentId: 't1', divisionId: 'd1' }), { wrapper });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latest().url).toBe(`ws://${window.location.host}/ws/brackets`);
    expect(latest().url).not.toMatch(/token/);
    expect(getItem).not.toHaveBeenCalled();

    act(() => latest().serverOpen());
    expect(JSON.parse(latest().sent[0])).toEqual({ type: 'subscribe', tournamentId: 't1', divisionId: 'd1' });
  });

  it('uses wss on https pages', () => {
    expect(bracketSocketUrl({ protocol: 'https:', host: 'app.example.test' })).toBe('wss://app.example.test/ws/brackets');
  });

  it('stops reconnecting and reports unauthorized on an auth-failure close', () => {
    const { result } = renderHook(() => useBracketWebSocket({ tournamentId: 't1', divisionId: 'd1' }), { wrapper });
    act(() => latest().serverOpen());
    act(() => latest().serverClose(1008));

    expect(result.current.connectionError).toBe('unauthorized');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('stops reconnecting and reports forbidden when the subscription is denied', () => {
    const { result } = renderHook(() => useBracketWebSocket({ tournamentId: 't1', divisionId: 'd1' }), { wrapper });
    act(() => latest().serverOpen());
    act(() => latest().serverMessage({ type: 'subscription_denied', divisionId: 'd1', reason: 'forbidden' }));
    act(() => latest().serverClose(4403));

    expect(result.current.connectionError).toBe('forbidden');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects with backoff after a transient drop', () => {
    const { result } = renderHook(() => useBracketWebSocket({ tournamentId: 't1', divisionId: 'd1' }), { wrapper });
    act(() => latest().serverOpen());
    expect(result.current.isConnected).toBe(true);
    act(() => latest().serverClose(1006));
    expect(result.current.isConnected).toBe(false);

    act(() => { vi.advanceTimersByTime(1_999); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('does not reopen the socket when the caller re-renders with new inline handlers', () => {
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ tag }: { tag: string }) => useBracketWebSocket({
        tournamentId: 't1',
        divisionId: 'd1',
        onMatchUpdate: (matchId) => seen.push(`${tag}:${matchId}`),
      }),
      { wrapper, initialProps: { tag: 'first' } },
    );
    act(() => latest().serverOpen());
    rerender({ tag: 'second' });
    rerender({ tag: 'third' });
    expect(FakeWebSocket.instances).toHaveLength(1);

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => latest().serverMessage({ type: 'match_updated', divisionId: 'd1', matchId: 'm1' }));
    expect(seen).toEqual(['third:m1']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['bracket', 'd1'] });
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = renderHook(() => useBracketWebSocket({ tournamentId: 't1', divisionId: 'd1' }), { wrapper });
    act(() => latest().serverOpen());
    unmount();
    expect(JSON.parse(latest().sent.at(-1) ?? '{}')).toEqual({ type: 'unsubscribe' });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('classifies terminal close codes', () => {
    expect(isTerminalCloseCode(1008)).toBe(true);
    expect(isTerminalCloseCode(4403)).toBe(true);
    expect(isTerminalCloseCode(1006)).toBe(false);
    expect(isTerminalCloseCode(1001)).toBe(false);
  });
});

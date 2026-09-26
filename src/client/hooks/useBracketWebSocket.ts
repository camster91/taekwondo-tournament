import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseBracketWebSocketOptions {
  tournamentId: string;
  divisionId: string;
  enabled?: boolean;
  onMatchUpdate?: (matchId: string, matchData: unknown) => void;
  onBracketRegenerated?: () => void;
}

interface BracketMessage {
  type: 'subscribed' | 'subscription_denied' | 'match_updated' | 'bracket_regenerated';
  divisionId?: string;
  matchId?: string;
  data?: unknown;
  reason?: string;
}

export type BracketConnectionError = 'unauthorized' | 'forbidden' | null;

/** Server close codes: 1008 = authentication failed, 4xxx = policy (4403 subscription denied). */
export function isTerminalCloseCode(code: number): boolean {
  return code === 1008 || (code >= 4000 && code <= 4999);
}

/** Same-origin endpoint; the browser attaches the HttpOnly session cookie. */
export function bracketSocketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/brackets`;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Hook for real-time bracket updates via WebSocket.
 *
 * Authentication rides on the HttpOnly `bowin_session` cookie that the
 * browser sends with the same-origin upgrade request — the JWT is not
 * readable from JS and is never put in the URL. Reconnects with
 * exponential backoff on transient drops, but stops on an auth/permission
 * close (1008 / 4xxx) and surfaces it via `connectionError`.
 */
export function useBracketWebSocket({
  tournamentId,
  divisionId,
  enabled = true,
  onMatchUpdate,
  onBracketRegenerated,
}: UseBracketWebSocketOptions) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const activeRef = useRef(false);
  // Handlers live in refs so inline callbacks from the caller don't tear
  // the socket down and reopen it on every render.
  const onMatchUpdateRef = useRef(onMatchUpdate);
  const onBracketRegeneratedRef = useRef(onBracketRegenerated);
  onMatchUpdateRef.current = onMatchUpdate;
  onBracketRegeneratedRef.current = onBracketRegenerated;

  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<BracketConnectionError>(null);

  const clearReconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (!enabled || !divisionId || !tournamentId) return;
    clearReconnect();
    activeRef.current = true;

    let ws: WebSocket;
    try {
      ws = new WebSocket(bracketSocketUrl(window.location));
    } catch (error) {
      console.error('[websocket] Failed to create connection:', error);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
      attemptsRef.current = 0;
      ws.send(JSON.stringify({ type: 'subscribe', tournamentId, divisionId }));
    };

    ws.onmessage = (event) => {
      let message: BracketMessage;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error('[websocket] Failed to parse message:', error);
        return;
      }
      if (message.type === 'subscription_denied') {
        setConnectionError('forbidden');
      } else if (message.type === 'match_updated' && message.matchId) {
        queryClient.invalidateQueries({ queryKey: ['bracket', divisionId] });
        onMatchUpdateRef.current?.(message.matchId, message.data);
      } else if (message.type === 'bracket_regenerated') {
        queryClient.invalidateQueries({ queryKey: ['bracket', divisionId] });
        onBracketRegeneratedRef.current?.();
      }
    };

    ws.onerror = () => {
      // The close event that follows carries the useful information.
    };

    ws.onclose = (event) => {
      if (wsRef.current === ws) wsRef.current = null;
      setIsConnected(false);
      if (!activeRef.current) return; // intentional disconnect / unmount

      if (isTerminalCloseCode(event.code)) {
        activeRef.current = false;
        setConnectionError(event.code === 1008 ? 'unauthorized' : 'forbidden');
        return;
      }

      attemptsRef.current += 1;
      const delay = Math.min(1000 * 2 ** attemptsRef.current, MAX_BACKOFF_MS);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };
  }, [enabled, divisionId, tournamentId, queryClient]);

  const disconnect = useCallback(() => {
    activeRef.current = false;
    clearReconnect();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe' }));
      }
      ws.close();
    }
    attemptsRef.current = 0;
    setIsConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    setConnectionError(null);
    connect();
  }, [connect, disconnect]);

  // Connect on mount / when the target changes, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    connectionError,
    reconnect,
    disconnect,
  };
}

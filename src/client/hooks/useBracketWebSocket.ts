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
  type: 'subscribed' | 'match_updated' | 'bracket_regenerated';
  divisionId?: string;
  matchId?: string;
  data?: unknown;
}

/**
 * Hook for real-time bracket updates via WebSocket.
 * Automatically handles reconnection and query invalidation.
 *
 * Authentication: the JWT lives in the HttpOnly `bowin_session` cookie
 * (set by the server on login). The browser auto-attaches same-origin
 * cookies on the WebSocket upgrade handshake, so the client never reads
 * the token. The native `WebSocket` constructor has no `credentials`
 * option (unlike `fetch`) — same-origin is the only mode that sends
 * cookies, and we connect to `window.location.host` so the browser
 * handles it for us.
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
  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !divisionId || !tournamentId) return;

    // Bail out cleanly when the API isn't available (SSR, tests without
    // jsdom, etc.). Surfacing a clear error here is what the SH-1 fix
    // promises: live bracket updates were previously silent-failing
    // with a console.warn and no error state.
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      const message = 'WebSocket is not available in this environment';
      setConnectionError(message);
      console.warn('[websocket]', message);
      return;
    }

    try {
      // Construct same-origin WebSocket URL. The HttpOnly session cookie
      // is attached by the browser on the upgrade request; we MUST NOT
      // put the token in the query string (the post-cookie-migration
      // contract — the JWT no longer lives in localStorage).
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/brackets`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setConnectionError(null);

      ws.onopen = () => {
        console.log('[websocket] Connected to bracket updates');
        setIsConnected(true);
        setConnectionAttempts(0);
        setConnectionError(null);

        // Subscribe to division updates
        ws.send(JSON.stringify({
          type: 'subscribe',
          tournamentId,
          divisionId,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: BracketMessage = JSON.parse(event.data);

          if (message.type === 'subscribed') {
            console.log(`[websocket] Subscribed to division ${message.divisionId}`);
          } else if (message.type === 'match_updated' && message.matchId) {
            console.log(`[websocket] Match ${message.matchId} updated`);

            // Invalidate bracket query to refetch
            queryClient.invalidateQueries({ queryKey: ['bracket', divisionId] });

            // Call custom handler if provided
            if (onMatchUpdate) {
              onMatchUpdate(message.matchId, message.data);
            }
          } else if (message.type === 'bracket_regenerated') {
            console.log(`[websocket] Bracket regenerated for division ${message.divisionId}`);

            // Invalidate bracket query to refetch
            queryClient.invalidateQueries({ queryKey: ['bracket', divisionId] });

            // Call custom handler if provided
            if (onBracketRegenerated) {
              onBracketRegenerated();
            }
          }
        } catch (error) {
          console.error('[websocket] Failed to parse message:', error);
        }
      };

      ws.onerror = () => {
        // The browser intentionally hides error details from JS for
        // cross-origin WebSockets; we can't read the underlying cause.
        // Surface a stable message so the consumer can show a banner
        // instead of silently leaving live updates dead.
        const message = 'WebSocket connection error — live bracket updates are unavailable';
        console.error('[websocket]', message);
        setConnectionError(message);
      };

      ws.onclose = (event) => {
        console.log(`[websocket] Connection closed: ${event.code} ${event.reason}`);
        setIsConnected(false);
        wsRef.current = null;

        // Stop reconnecting on auth-failure closes so we don't loop
        // forever with a stale token. The server signals this with
        //   - 1008 (IANA "Policy Violation") — what we use for missing
        //     / invalid JWT on the upgrade handshake
        //   - 4xxx — the private-range close codes application servers
        //     conventionally use for "go away, your token is bad"
        // Network-level errors (1006 "Abnormal Closure") keep the
        // exponential-backoff reconnect path intact.
        const isAuthFailure =
          event.code === 1008 || (event.code >= 4000 && event.code < 5000);
        if (isAuthFailure) {
          const message = `WebSocket closed by server (code ${event.code}${event.reason ? `: ${event.reason}` : ''}) — re-authentication may be required`;
          console.error('[websocket]', message);
          setConnectionError(message);
          return;
        }

        // Attempt reconnection with exponential backoff (max 30s)
        if (enabled) {
          const attempts = connectionAttempts + 1;
          setConnectionAttempts(attempts);

          const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
          console.log(`[websocket] Reconnecting in ${delay}ms (attempt ${attempts})...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create WebSocket connection';
      console.error('[websocket]', message);
      setConnectionError(message);
    }
  }, [enabled, divisionId, tournamentId, connectionAttempts, queryClient, onMatchUpdate, onBracketRegenerated]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      // Send unsubscribe before closing
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'unsubscribe',
        }));
      }

      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setConnectionAttempts(0);
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    connectionError,
    reconnect: connect,
    disconnect,
  };
}

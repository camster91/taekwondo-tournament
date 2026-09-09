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
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const connect = useCallback(() => {
    if (!enabled || !divisionId || !tournamentId) return;

    // Get JWT from localStorage
    const token = localStorage.getItem('bowin_session') || localStorage.getItem('tkd_auth_token');
    if (!token) {
      console.warn('[websocket] No auth token available');
      return;
    }

    try {
      // Construct WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/brackets?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[websocket] Connected to bracket updates');
        setIsConnected(true);
        setConnectionAttempts(0);

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

      ws.onerror = (error) => {
        console.error('[websocket] Connection error:', error);
      };

      ws.onclose = (event) => {
        console.log(`[websocket] Connection closed: ${event.code} ${event.reason}`);
        setIsConnected(false);
        wsRef.current = null;

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
      console.error('[websocket] Failed to create connection:', error);
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
    reconnect: connect,
    disconnect,
  };
}

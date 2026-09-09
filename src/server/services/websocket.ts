import type { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { verifyToken } from '../middleware/auth.js';

interface BracketClient {
  ws: WebSocket;
  userId: string;
  tournamentId: string;
  divisionId: string;
}

interface BracketMessage {
  type: 'subscribe' | 'unsubscribe' | 'match_updated' | 'bracket_regenerated';
  tournamentId?: string;
  divisionId?: string;
  matchId?: string;
  data?: unknown;
}

// Map of divisionId -> Set of connected clients
const divisionSubscriptions = new Map<string, Set<BracketClient>>();

export function initializeWebSocket(server: HTTPServer): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/brackets',
    // Verify origin in production (allow same-origin + configured origins)
    verifyClient: (info, callback) => {
      const origin = info.origin || info.req.headers.origin;
      const allowed = process.env.ALLOWED_ORIGINS?.split(',') || [];
      
      // In development, allow localhost
      if (process.env.NODE_ENV !== 'production') {
        callback(true);
        return;
      }

      // In production, require origin to be in ALLOWED_ORIGINS
      if (origin && allowed.some(o => o.trim() === origin)) {
        callback(true);
      } else {
        callback(false, 403, 'Forbidden');
      }
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let client: BracketClient | null = null;

    // Extract JWT from query string (WebSocket doesn't support headers cleanly)
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Missing authentication token');
      return;
    }

    // Verify JWT
    const payload = verifyToken(token);
    if (!payload) {
      ws.close(1008, 'Invalid authentication token');
      return;
    }

    // Connection is authenticated
    const userId = payload.userId;

    ws.on('message', (message: Buffer) => {
      try {
        const msg: BracketMessage = JSON.parse(message.toString());

        if (msg.type === 'subscribe' && msg.tournamentId && msg.divisionId) {
          // Subscribe to division updates
          client = {
            ws,
            userId,
            tournamentId: msg.tournamentId,
            divisionId: msg.divisionId,
          };

          if (!divisionSubscriptions.has(msg.divisionId)) {
            divisionSubscriptions.set(msg.divisionId, new Set());
          }
          divisionSubscriptions.get(msg.divisionId)!.add(client);

          // Send confirmation
          ws.send(JSON.stringify({
            type: 'subscribed',
            divisionId: msg.divisionId,
          }));
        } else if (msg.type === 'unsubscribe' && client) {
          // Unsubscribe from division
          const subs = divisionSubscriptions.get(client.divisionId);
          if (subs) {
            subs.delete(client);
            if (subs.size === 0) {
              divisionSubscriptions.delete(client.divisionId);
            }
          }
          client = null;
        }
      } catch (error) {
        console.error('[websocket] message parse error:', error);
      }
    });

    ws.on('close', () => {
      // Clean up subscriptions
      if (client) {
        const subs = divisionSubscriptions.get(client.divisionId);
        if (subs) {
          subs.delete(client);
          if (subs.size === 0) {
            divisionSubscriptions.delete(client.divisionId);
          }
        }
      }
    });

    ws.on('error', (error) => {
      console.error('[websocket] connection error:', error);
    });
  });

  console.log('[websocket] WebSocket server initialized at /ws/brackets');
  return wss;
}

/**
 * Broadcast a match update to all clients subscribed to the division.
 */
export function broadcastMatchUpdate(divisionId: string, matchId: string, matchData: unknown): void {
  const subs = divisionSubscriptions.get(divisionId);
  if (!subs || subs.size === 0) return;

  const message = JSON.stringify({
    type: 'match_updated',
    divisionId,
    matchId,
    data: matchData,
  });

  subs.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

/**
 * Broadcast a bracket regeneration event to all clients subscribed to the division.
 */
export function broadcastBracketRegenerated(divisionId: string): void {
  const subs = divisionSubscriptions.get(divisionId);
  if (!subs || subs.size === 0) return;

  const message = JSON.stringify({
    type: 'bracket_regenerated',
    divisionId,
  });

  subs.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

/**
 * Get the count of active WebSocket connections per division.
 */
export function getSubscriptionStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  divisionSubscriptions.forEach((subs, divisionId) => {
    stats[divisionId] = subs.size;
  });
  return stats;
}

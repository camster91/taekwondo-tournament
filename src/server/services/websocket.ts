import type { Server as HTTPServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { PrismaClient } from '@prisma/client';
import {
  verifyToken,
  checkTournamentAccess,
  SESSION_COOKIE,
  type AuthenticatedRequest,
} from '../middleware/auth.js';

type WsUser = NonNullable<AuthenticatedRequest['user']>;

interface BracketClient {
  ws: WebSocket;
  userId: string;
  tournamentId: string;
  divisionId: string;
}

interface BracketMessage {
  type?: unknown;
  tournamentId?: unknown;
  divisionId?: unknown;
}

/**
 * Close codes. 1008 (policy violation) = authentication failed;
 * 4403 (application range, mirrors HTTP 403) = subscription refused.
 * The client stops reconnecting on either.
 */
export const WS_CLOSE_AUTH_FAILED = 1008;
export const WS_CLOSE_FORBIDDEN = 4403;

/** Subscribe messages are tiny; anything larger is abuse. */
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_ID_LENGTH = 128;

// Map of divisionId -> Set of connected clients
const divisionSubscriptions = new Map<string, Set<BracketClient>>();

/**
 * Read the session JWT from the upgrade request.
 *
 * Browsers attach the HttpOnly `bowin_session` cookie to same-origin
 * WebSocket handshakes automatically, which is the only credential the
 * SPA has (the JWT is not readable from JS). Non-browser clients may
 * send `Authorization: Bearer`. Query-string tokens are NOT accepted:
 * URLs end up in proxy/access logs and browser history.
 */
export function extractUpgradeToken(req: Pick<IncomingMessage, 'headers'>): string | null {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
      const raw = part.slice(eq + 1).trim();
      try {
        const value = decodeURIComponent(raw);
        if (value) return value;
      } catch {
        return null;
      }
    }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

/**
 * Authenticate a WebSocket upgrade with the same rules as the HTTP
 * `authenticate` middleware: valid HS256 JWT, user exists and is active,
 * and the token's `tokenVersion` still matches (logout / role change /
 * deactivation revoke sockets on their next connect).
 */
export async function authenticateUpgrade(
  req: Pick<IncomingMessage, 'headers'>,
  prisma: PrismaClient,
): Promise<WsUser | null> {
  const token = extractUpgradeToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true, tokenVersion: true, demoExpiresAt: true },
  });
  if (!user || !user.isActive) return null;
  if (user.tokenVersion !== (payload.tokenVersion ?? -1)) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    isDemo: user.demoExpiresAt !== null,
  };
}

export type SubscriptionDecision =
  | { ok: true; tournamentId: string; divisionId: string }
  | { ok: false; reason: 'invalid_request' | 'not_found' | 'forbidden' };

/**
 * Per-resource authorization for a subscribe request. The division is
 * resolved server-side; the client-supplied tournamentId must match the
 * division's real tournament (so a client cannot pair a division from
 * another tenant with a tournament it can see), and the user must have
 * at least viewer access to that tournament under the standard tenant
 * model (`checkTournamentAccess`). Fails closed on any error.
 */
export async function authorizeSubscription(
  user: WsUser,
  prisma: PrismaClient,
  tournamentId: unknown,
  divisionId: unknown,
): Promise<SubscriptionDecision> {
  if (
    typeof tournamentId !== 'string' || typeof divisionId !== 'string' ||
    !tournamentId || !divisionId ||
    tournamentId.length > MAX_ID_LENGTH || divisionId.length > MAX_ID_LENGTH
  ) {
    return { ok: false, reason: 'invalid_request' };
  }
  try {
    const division = await prisma.division.findUnique({
      where: { id: divisionId },
      select: { tournamentId: true, deletedAt: true },
    });
    // Same response for "missing", "deleted" and "belongs to another
    // tournament" so the socket cannot be used to probe ids.
    if (!division || division.deletedAt || division.tournamentId !== tournamentId) {
      return { ok: false, reason: 'not_found' };
    }
    const access = await checkTournamentAccess({ user }, prisma, division.tournamentId, 'viewer');
    if (!access.ok) {
      return { ok: false, reason: access.status === 404 ? 'not_found' : 'forbidden' };
    }
    return { ok: true, tournamentId: division.tournamentId, divisionId };
  } catch {
    return { ok: false, reason: 'forbidden' };
  }
}

function removeClient(client: BracketClient | null): void {
  if (!client) return;
  const subs = divisionSubscriptions.get(client.divisionId);
  if (subs) {
    subs.delete(client);
    if (subs.size === 0) {
      divisionSubscriptions.delete(client.divisionId);
    }
  }
}

export function isOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  const allowed = env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
  return Boolean(origin && allowed.includes(origin));
}

export interface InitializeWebSocketOptions {
  /** Prisma client for authentication and per-subscribe authorization. */
  prisma: PrismaClient;
}

export function initializeWebSocket(server: HTTPServer, { prisma }: InitializeWebSocketOptions): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/brackets',
    maxPayload: MAX_MESSAGE_BYTES,
    // Verify origin in production (allow configured origins only)
    verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }, callback: (result: boolean, code?: number, message?: string) => void) => {
      if (isOriginAllowed(info.origin || info.req.headers.origin)) {
        callback(true);
      } else {
        callback(false, 403, 'Forbidden');
      }
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let client: BracketClient | null = null;
    let closed = false;
    // Bumped on every subscribe/unsubscribe so a slow authorization for
    // an older request can never overwrite a newer one.
    let generation = 0;

    const authPromise = authenticateUpgrade(req, prisma).catch(() => null);
    void authPromise.then((user) => {
      if (!user && !closed) ws.close(WS_CLOSE_AUTH_FAILED, 'Authentication required');
    });

    ws.on('message', (message: Buffer) => {
      let msg: BracketMessage;
      try {
        msg = JSON.parse(message.toString()) as BracketMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      const current = ++generation;
      void authPromise.then(async (user) => {
        if (!user || closed) return;

        if (msg.type === 'unsubscribe') {
          removeClient(client);
          client = null;
          return;
        }
        if (msg.type !== 'subscribe') return;

        const decision = await authorizeSubscription(user, prisma, msg.tournamentId, msg.divisionId);
        if (closed || current !== generation) return;

        if (!decision.ok) {
          removeClient(client);
          client = null;
          ws.send(JSON.stringify({
            type: 'subscription_denied',
            divisionId: typeof msg.divisionId === 'string' ? msg.divisionId : undefined,
            reason: decision.reason,
          }));
          ws.close(WS_CLOSE_FORBIDDEN, 'Subscription denied');
          return;
        }

        // One subscription per socket: drop any previous one first.
        removeClient(client);
        const next: BracketClient = {
          ws,
          userId: user.id,
          tournamentId: decision.tournamentId,
          divisionId: decision.divisionId,
        };
        client = next;
        let subs = divisionSubscriptions.get(next.divisionId);
        if (!subs) {
          subs = new Set();
          divisionSubscriptions.set(next.divisionId, subs);
        }
        subs.add(next);

        ws.send(JSON.stringify({
          type: 'subscribed',
          divisionId: next.divisionId,
        }));
      }).catch((error: unknown) => {
        console.error('[websocket] message handling error:', error);
      });
    });

    ws.on('close', () => {
      closed = true;
      removeClient(client);
      client = null;
    });

    ws.on('error', (error: Error) => {
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

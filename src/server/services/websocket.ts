import type { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { PrismaClient } from '@prisma/client';
import { verifyToken, SESSION_COOKIE } from '../middleware/auth.js';
import { WsPubSub } from './ws-pubsub.js';

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

/**
 * Local-only connection set. Each instance keeps its own map of
 * divisionId -> WebSocket clients connected to THIS process. The
 * publish path goes through Postgres LISTEN/NOTIFY (see WsPubSub)
 * so a second instance still receives broadcasts.
 */
const divisionSubscriptions = new Map<string, Set<BracketClient>>();

/**
 * Refcount of active local subscribers per topic. We LISTEN on a
 * Postgres channel only while at least one local connection cares
 * about it, and UNLISTEN when the count drops back to zero. This
 * keeps the LISTEN client's channel set bounded by the number of
 * divisions a single instance has open, not the global count.
 */
const pubsubRefcount = new Map<string, number>();

/**
 * Module-level pubsub + wss + fanout state. Created lazily on the
 * first `initializeWebSocket` call so importing this module in a
 * test doesn't open a Postgres connection. Tests can inject a
 * pre-started WsPubSub via `InitializeWebSocketOptions.pubsub`.
 */
let activePubSub: WsPubSub | null = null;
let activeWss: WebSocketServer | null = null;
let activeFanout: ((topic: string, payload: string) => void) | null = null;

function getPubSub(): WsPubSub {
  if (!activePubSub) {
    throw new Error(
      '[websocket] WsPubSub is not initialized. Call initializeWebSocket() at server startup.',
    );
  }
  return activePubSub;
}

export interface InitializeWebSocketOptions {
  /**
   * Override the pubsub. Defaults to a new WsPubSub bound to
   * `process.env.DATABASE_URL`. Tests pass a pre-started instance
   * so the cross-instance contract is exercised end-to-end.
   */
  pubsub?: WsPubSub;
  /**
   * Prisma client used for the per-subscribe authorization check
   * (closes HIGH #6 from the backend review). Required in
   * production; when omitted, the subscribe handler falls back to
   * an in-process allow-list of admin users from the JWT so test
   * rigs without a database can still mount the server.
   */
  prisma?: PrismaClient;
}

export async function initializeWebSocket(
  server: HTTPServer,
  options: InitializeWebSocketOptions = {},
): Promise<WebSocketServer> {
  const pubsub = options.pubsub ?? new WsPubSub({ connectionString: process.env.DATABASE_URL ?? '' });
  if (!options.pubsub) {
    await pubsub.start();
  }
  activePubSub = pubsub;
  const wss = new WebSocketServer({
    server,
    path: '/ws/brackets',
    // Verify origin in production (allow same-origin + configured origins)
    verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }, callback: (result: boolean, code?: number, message?: string) => void) => {
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

    // Auth: prefer the HttpOnly `bowin_session` cookie (set on login).
    // Browsers auto-attach same-origin cookies on the WebSocket upgrade
    // handshake, so the browser path needs no extra work. The
    // `?token=` query string is kept as a fallback for non-browser
    // clients (curl, scripts, tests) that can't carry a cookie.
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = extractSessionToken(req.headers.cookie) || url.searchParams.get('token');

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
          // Pull the strings into local consts so the narrowing
          // from the `&&` guard above survives across the async
          // boundary. Otherwise the closure's BracketMessage
          // type widens back to `string | undefined` and the
          // assignment to BracketClient fails the build.
          const tournamentId: string = msg.tournamentId;
          const divisionId: string = msg.divisionId;
          // HIGH #6: per-resource authorization. The previous
          // version trusted msg.tournamentId / msg.divisionId
          // straight from the client, so any authenticated user
          // could subscribe to any other tenant's bracket feed
          // and receive live match updates. We now resolve the
          // division -> tournament mapping and the user's
          // UserTournamentAccess row before joining the
          // subscription set. Mismatched tournament or missing
          // access row → `subscription_denied` + socket close.
          //
          // The check is async: we set `client` after the
          // promise resolves, so a rejected subscribe never
          // accidentally lands in the local fanout map.
          void handleSubscribe({
            ws,
            userId,
            role: payload.role,
            tournamentId,
            divisionId,
            prisma: options.prisma,
          }).then((outcome) => {
            if (outcome.kind === 'denied') {
              try {
                ws.send(JSON.stringify({
                  type: 'subscription_denied',
                  tournamentId,
                  divisionId,
                  reason: outcome.reason,
                }));
              } catch (err) {
                console.error('[websocket] failed to send subscription_denied:', err);
              }
              // 4xxx is the ws-library convention for application
              // policy failure. 4403 mirrors HTTP 403.
              ws.close(4403, `Subscription denied: ${outcome.reason}`);
              return;
            }
            const newClient: BracketClient = {
              ws,
              userId,
              tournamentId,
              divisionId,
            };
            client = newClient;
            if (!divisionSubscriptions.has(divisionId)) {
              divisionSubscriptions.set(divisionId, new Set());
            }
            divisionSubscriptions.get(divisionId)!.add(newClient);

            // Bump the refcount and LISTEN on the Postgres channel
            // when this instance's first local subscriber appears for
            // the topic. Done asynchronously — even if LISTEN fails,
            // the local subscription is still recorded so the local
            // fanout path keeps working.
            const prev = pubsubRefcount.get(divisionId) ?? 0;
            pubsubRefcount.set(divisionId, prev + 1);
            if (prev === 0) {
              void pubsub.subscribe(divisionId).catch((err: unknown) => {
                console.error(
                  `[websocket] pubsub.subscribe(${divisionId}) failed:`,
                  err,
                );
              });
            }

            // Send confirmation
            ws.send(JSON.stringify({
              type: 'subscribed',
              divisionId,
            }));
          }).catch((err: unknown) => {
            // Fail-closed: if the auth check itself blows up
            // (DB down, malformed payload, etc.) we refuse the
            // subscription rather than silently granting access.
            console.error('[websocket] subscribe authorization error:', err);
            try {
              ws.send(JSON.stringify({
                type: 'subscription_denied',
                tournamentId,
                divisionId,
                reason: 'authorization_error',
              }));
            } catch {
              // best-effort
            }
            ws.close(4403, 'Subscription denied: authorization_error');
          });
        } else if (msg.type === 'unsubscribe' && client) {
          // Unsubscribe from division
          const subs = divisionSubscriptions.get(client.divisionId);
          if (subs) {
            subs.delete(client);
            if (subs.size === 0) {
              divisionSubscriptions.delete(client.divisionId);
            }
          }
          decrementPubsubRefcount(client.divisionId, pubsub);
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
        decrementPubsubRefcount(client.divisionId, pubsub);
      }
    });

    ws.on('error', (error: Error) => {
      console.error('[websocket] connection error:', error);
    });
  });

  /**
   * Local fanout: when Postgres delivers a NOTIFY for a topic, push
   * the JSON payload to every local connection subscribed to that
   * topic. The payload is the exact JSON the publish path wrote, so
   * cross-instance traffic looks identical to local-loopback traffic
   * to the client.
   */
  const fanout = (topic: string, payload: string): void => {
    const subs = divisionSubscriptions.get(topic);
    if (!subs || subs.size === 0) return;
    subs.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  };
  activeWss = wss;
  activeFanout = fanout;
  pubsub.on('message', fanout);

  console.log('[websocket] WebSocket server initialized at /ws/brackets');
  return wss;
}

/**
 * Per-resource authorization result for a `subscribe` message.
 * `allowed` is the only path that lands a connection in the
 * fanout map; `denied` carries a reason the client can show in
 * the UI and a matching ws close code (4403).
 */
type SubscribeAuthResult =
  | { kind: 'allowed' }
  | { kind: 'denied'; reason: string };

interface SubscribeAuthInput {
  userId: string;
  role?: string;
  tournamentId: string;
  divisionId: string;
  prisma?: PrismaClient;
}

/**
 * Resolve whether the connecting user is allowed to subscribe to
 * `divisionId` inside `tournamentId`.
 *
 * Two layers of check, both required:
 *
 * 1. The division must actually belong to the requested
 *    tournament. Otherwise a user with access to tournament A
 *    could subscribe by passing any divisionId from tournament B
 *    and still get B's match updates (the local fanout is keyed
 *    by divisionId, not tournamentId).
 *
 * 2. The user must have a `UserTournamentAccess` row for the
 *    tournament with role `director` / `scorekeeper` / `viewer`,
 *    OR hold the global `admin` role on their JWT. The `admin`
 *    bypass mirrors `checkTournamentAccess` so platform staff
 *    don't need a per-tournament row.
 *
 * When `prisma` is not provided (test rigs, in-process unit
 * tests), we degrade to JWT-role-only: any JWT with `role !==
 * 'viewer'` is allowed, and the division-membership check is
 * skipped. The production path always supplies a Prisma client.
 */
async function checkSubscribeAuthorization(
  input: SubscribeAuthInput,
): Promise<SubscribeAuthResult> {
  const { userId, role, tournamentId, divisionId, prisma } = input;

  // Platform admins short-circuit before any DB read. The role
  // comes from the verified JWT, so a forged subscribe cannot
  // bypass this.
  if (role === 'admin') {
    return { kind: 'allowed' };
  }

  if (!prisma) {
    // No DB available — fall back to a JWT-only check so test
    // rigs without Postgres can still mount the server. Score
    // updaters and above are accepted; viewers are denied. This
    // path is unreachable in production because
    // `src/server/index.ts` always passes the prisma client.
    if (role && role !== 'viewer') {
      return { kind: 'allowed' };
    }
    return { kind: 'denied', reason: 'no_database' };
  }

  // Verify the division belongs to the tournament the client
  // claimed. Doing this first means a user with access to
  // tournament A cannot probe divisionIds from tournament B and
  // (if (2) is also lenient) silently subscribe.
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { tournamentId: true },
  });
  if (!division) {
    return { kind: 'denied', reason: 'division_not_found' };
  }
  if (division.tournamentId !== tournamentId) {
    return { kind: 'denied', reason: 'tournament_mismatch' };
  }

  const access = await prisma.userTournamentAccess.findFirst({
    where: {
      userId,
      tournamentId,
      role: { in: ['director', 'scorekeeper', 'viewer'] },
    },
    select: { id: true },
  });
  if (!access) {
    return { kind: 'denied', reason: 'forbidden' };
  }
  return { kind: 'allowed' };
}

interface HandleSubscribeInput {
  ws: WebSocket;
  userId: string;
  role?: string;
  tournamentId: string;
  divisionId: string;
  prisma?: PrismaClient;
}

async function handleSubscribe(input: HandleSubscribeInput): Promise<SubscribeAuthResult> {
  return checkSubscribeAuthorization(input);
}

/**
 * Drop the pubsub refcount for a topic and UNLISTEN when the last
 * local subscriber leaves. Best-effort: an UNLISTEN failure just
 * means the channel lingers in this instance's LISTEN set until
 * the process restarts, which is harmless.
 */
function decrementPubsubRefcount(topic: string, pubsub: WsPubSub): void {
  const current = pubsubRefcount.get(topic) ?? 0;
  if (current <= 1) {
    pubsubRefcount.delete(topic);
    void pubsub.unsubscribe(topic).catch((err: unknown) => {
      console.error(`[websocket] pubsub.unsubscribe(${topic}) failed:`, err);
    });
  } else {
    pubsubRefcount.set(topic, current - 1);
  }
}

/**
 * Close the WebSocket server and the underlying pubsub. Used during
 * graceful shutdown. Idempotent.
 */
export async function closeWebSocket(): Promise<void> {
  const wss = activeWss;
  const pubsub = activePubSub;
  const fanout = activeFanout;

  if (fanout && pubsub) {
    pubsub.off('message', fanout);
  }
  activeFanout = null;

  if (wss) {
    // Close all live client connections so the shutdown timer in
    // server.js isn't blocked on a hung WebSocket. ws.close() stops
    // accepting upgrades; iterating wss.clients actively closes the
    // existing ones.
    for (const client of wss.clients) {
      try {
        client.close(1001, 'Server shutting down');
      } catch (err) {
        console.error('[websocket] error closing client:', err);
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    activeWss = null;
  }

  if (pubsub) {
    await pubsub.close();
    activePubSub = null;
  }

  divisionSubscriptions.clear();
  pubsubRefcount.clear();
}

/**
 * Broadcast a match update to all clients subscribed to the division.
 *
 * The publish goes through Postgres LISTEN/NOTIFY so subscribers on
 * other app instances receive the same payload.
 */
export function broadcastMatchUpdate(divisionId: string, matchId: string, matchData: unknown): void {
  const payload = JSON.stringify({
    type: 'match_updated',
    divisionId,
    matchId,
    data: matchData,
  });

  // Fire-and-forget; the publish is async but the broadcast contract
  // is best-effort. Surface errors so an operator notices if Postgres
  // is rejecting NOTIFYs.
  void getPubSub().publish(divisionId, payload).catch((err: unknown) => {
    console.error(`[websocket] broadcastMatchUpdate(${divisionId}) failed:`, err);
  });
}

/**
 * Broadcast a bracket regeneration event to all clients subscribed to the division.
 */
export function broadcastBracketRegenerated(divisionId: string): void {
  const payload = JSON.stringify({
    type: 'bracket_regenerated',
    divisionId,
  });
  void getPubSub().publish(divisionId, payload).catch((err: unknown) => {
    console.error(`[websocket] broadcastBracketRegenerated(${divisionId}) failed:`, err);
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

/**
 * Parse the Cookie header and return the value of the session cookie,
 * or null if it's not present. We avoid pulling in the `cookie` package
 * as a direct dependency for this single use — the JWT body is
 * base64url so trimming/light decoding is enough here.
 */
function extractSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const rawName = pair.slice(0, eqIdx).trim();
    if (rawName !== SESSION_COOKIE) continue;
    const rawValue = pair.slice(eqIdx + 1).trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      // Malformed percent-encoding — fall through and return raw value.
      return rawValue;
    }
  }
  return null;
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { PrismaClient } from '@prisma/client';
import { WebSocket, type WebSocketServer } from 'ws';
import { createToken, SESSION_COOKIE, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  authenticateUpgrade,
  authorizeSubscription,
  broadcastMatchUpdate,
  extractUpgradeToken,
  getSubscriptionStats,
  initializeWebSocket,
  isOriginAllowed,
  revalidateConnection,
  WS_CLOSE_AUTH_FAILED,
  WS_CLOSE_FORBIDDEN,
} from './websocket.js';

type WsUser = NonNullable<AuthenticatedRequest['user']>;

/*
 * In-memory tenant fixture:
 *   org-a: tournament t-a (division d-a), member alice (owner)
 *   org-b: tournament t-b (division d-b), member bob (owner)
 *   orphan tournament t-legacy (division d-legacy)
 *   d-deleted: soft-deleted division in t-a
 *   carol: scorekeeper with an explicit UserTournamentAccess on t-b, member of org-a
 */
interface FakeUser { id: string; email: string; role: string; firstName: string; lastName: string; isActive: boolean; tokenVersion: number; demoExpiresAt: Date | null }
const users: Record<string, FakeUser> = {
  admin: { id: 'admin', email: 'admin@example.test', role: 'admin', firstName: 'A', lastName: 'D', isActive: true, tokenVersion: 0, demoExpiresAt: null },
  alice: { id: 'alice', email: 'alice@example.test', role: 'director', firstName: 'A', lastName: 'L', isActive: true, tokenVersion: 3, demoExpiresAt: null },
  bob: { id: 'bob', email: 'bob@example.test', role: 'director', firstName: 'B', lastName: 'O', isActive: true, tokenVersion: 0, demoExpiresAt: null },
  carol: { id: 'carol', email: 'carol@example.test', role: 'scorekeeper', firstName: 'C', lastName: 'A', isActive: true, tokenVersion: 0, demoExpiresAt: null },
  dave: { id: 'dave', email: 'dave@example.test', role: 'director', firstName: 'D', lastName: 'A', isActive: false, tokenVersion: 0, demoExpiresAt: null },
};
const tournaments: Record<string, { organizationId: string | null; deletedAt: Date | null }> = {
  't-a': { organizationId: 'org-a', deletedAt: null },
  't-b': { organizationId: 'org-b', deletedAt: null },
  't-legacy': { organizationId: null, deletedAt: null },
};
const divisions: Record<string, { tournamentId: string; deletedAt: Date | null }> = {
  'd-a': { tournamentId: 't-a', deletedAt: null },
  'd-b': { tournamentId: 't-b', deletedAt: null },
  'd-legacy': { tournamentId: 't-legacy', deletedAt: null },
  'd-deleted': { tournamentId: 't-a', deletedAt: new Date() },
};
const memberships = [
  { organizationId: 'org-a', userId: 'alice', role: 'owner' },
  { organizationId: 'org-b', userId: 'bob', role: 'owner' },
  { organizationId: 'org-a', userId: 'carol', role: 'member' },
];
const grants = [{ userId: 'carol', tournamentId: 't-b', role: 'viewer' }];

let throwOnDivision = false;
let throwOnUser = false;
const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (throwOnUser) throw new Error('db down');
      return users[where.id] ?? null;
    },
  },
  division: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (throwOnDivision) throw new Error('db down');
      return divisions[where.id] ?? null;
    },
  },
  tournament: { findUnique: async ({ where }: { where: { id: string } }) => tournaments[where.id] ?? null },
  userTournamentAccess: {
    findUnique: async ({ where }: { where: { userId_tournamentId: { userId: string; tournamentId: string } } }) =>
      grants.find((g) => g.userId === where.userId_tournamentId.userId && g.tournamentId === where.userId_tournamentId.tournamentId) ?? null,
  },
  organizationMember: {
    findUnique: async ({ where }: { where: { organizationId_userId: { organizationId: string; userId: string } } }) =>
      memberships.find((m) => m.organizationId === where.organizationId_userId.organizationId && m.userId === where.organizationId_userId.userId) ?? null,
    count: async ({ where }: { where: { userId: string } }) => memberships.filter((m) => m.userId === where.userId).length,
  },
};
const prisma = fakePrisma as unknown as PrismaClient;

const tokenFor = (u: FakeUser, tokenVersion = u.tokenVersion) =>
  createToken({ userId: u.id, email: u.email, role: u.role, tokenVersion });
const wsUser = (u: FakeUser): WsUser => ({ id: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName, isDemo: false });

describe('extractUpgradeToken', () => {
  it('reads the HttpOnly session cookie among other cookies', () => {
    expect(extractUpgradeToken({ headers: { cookie: `theme=dark; ${SESSION_COOKIE}=abc.def.ghi; bowin_csrf=x` } })).toBe('abc.def.ghi');
    expect(extractUpgradeToken({ headers: { cookie: `${SESSION_COOKIE}=a%2Eb` } })).toBe('a.b');
  });

  it('falls back to an Authorization: Bearer header for non-browser clients', () => {
    expect(extractUpgradeToken({ headers: { authorization: 'Bearer tok' } })).toBe('tok');
  });

  it('returns null when no credential is present or the cookie is malformed', () => {
    expect(extractUpgradeToken({ headers: {} })).toBeNull();
    expect(extractUpgradeToken({ headers: { cookie: `other_${SESSION_COOKIE}=x` } })).toBeNull();
    expect(extractUpgradeToken({ headers: { cookie: `${SESSION_COOKIE}=%E0%A4%A` } })).toBeNull();
  });
});

describe('authenticateUpgrade', () => {
  it('accepts a valid cookie JWT for an active user with a current tokenVersion', async () => {
    const user = await authenticateUpgrade({ headers: { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice)}` } }, prisma);
    expect(user?.id).toBe('alice');
  });

  it('rejects revoked sessions, inactive users, forged and missing tokens', async () => {
    const stale = tokenFor(users.alice, 2);
    expect(await authenticateUpgrade({ headers: { cookie: `${SESSION_COOKIE}=${stale}` } }, prisma)).toBeNull();
    expect(await authenticateUpgrade({ headers: { cookie: `${SESSION_COOKIE}=${tokenFor(users.dave)}` } }, prisma)).toBeNull();
    expect(await authenticateUpgrade({ headers: { cookie: `${SESSION_COOKIE}=not-a-jwt` } }, prisma)).toBeNull();
    expect(await authenticateUpgrade({ headers: {} }, prisma)).toBeNull();
  });
});

describe('authorizeSubscription', () => {
  it('allows members of the owning organization and admins', async () => {
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-a', 'd-a')).toEqual({ ok: true, tournamentId: 't-a', divisionId: 'd-a' });
    expect((await authorizeSubscription(wsUser(users.admin), prisma, 't-b', 'd-b')).ok).toBe(true);
  });

  it('refuses a cross-tenant subscription', async () => {
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-b', 'd-b')).toEqual({ ok: false, reason: 'forbidden' });
    expect(await authorizeSubscription(wsUser(users.bob), prisma, 't-a', 'd-a')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('honours explicit per-tournament grants and keeps tenant users out of the legacy pool', async () => {
    expect((await authorizeSubscription(wsUser(users.carol), prisma, 't-b', 'd-b')).ok).toBe(true);
    expect(await authorizeSubscription(wsUser(users.carol), prisma, 't-legacy', 'd-legacy')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('rejects pairing a foreign division with a tournament the user can access', async () => {
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-a', 'd-b')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('treats missing and soft-deleted divisions as not found', async () => {
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-a', 'nope')).toEqual({ ok: false, reason: 'not_found' });
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-a', 'd-deleted')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects malformed ids and fails closed on database errors', async () => {
    expect(await authorizeSubscription(wsUser(users.alice), prisma, undefined, 'd-a')).toEqual({ ok: false, reason: 'invalid_request' });
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-a', { $ne: null })).toEqual({ ok: false, reason: 'invalid_request' });
    expect(await authorizeSubscription(wsUser(users.alice), prisma, 't-a', 'x'.repeat(200))).toEqual({ ok: false, reason: 'invalid_request' });
    throwOnDivision = true;
    try {
      expect(await authorizeSubscription(wsUser(users.admin), prisma, 't-a', 'd-a')).toEqual({ ok: false, reason: 'forbidden' });
    } finally {
      throwOnDivision = false;
    }
  });
});

describe('revalidateConnection', () => {
  const aliceReq = () => ({ headers: { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice)}` } });

  it('passes a live session with no subscription and one that still has access', async () => {
    expect(await revalidateConnection(aliceReq(), prisma, null)).toBe('ok');
    expect(await revalidateConnection(aliceReq(), prisma, { tournamentId: 't-a', divisionId: 'd-a' })).toBe('ok');
  });

  it('reports a revoked session and a subscription that lost access', async () => {
    const stale = { headers: { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice, 2)}` } };
    expect(await revalidateConnection(stale, prisma, null)).toBe('unauthenticated');
    expect(await revalidateConnection(aliceReq(), prisma, { tournamentId: 't-a', divisionId: 'd-deleted' })).toBe('forbidden');
    expect(await revalidateConnection(aliceReq(), prisma, { tournamentId: 't-b', divisionId: 'd-b' })).toBe('forbidden');
  });

  it('returns unknown on database errors instead of disconnecting', async () => {
    throwOnUser = true;
    try {
      expect(await revalidateConnection(aliceReq(), prisma, null)).toBe('unknown');
    } finally {
      throwOnUser = false;
    }
    throwOnDivision = true;
    try {
      expect(await revalidateConnection(aliceReq(), prisma, { tournamentId: 't-a', divisionId: 'd-a' })).toBe('unknown');
    } finally {
      throwOnDivision = false;
    }
  });
});

describe('isOriginAllowed', () => {
  it('requires an allow-listed origin in production', () => {
    const env = { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.example.test, https://other.example.test' } as NodeJS.ProcessEnv;
    expect(isOriginAllowed('https://app.example.test', env)).toBe(true);
    expect(isOriginAllowed('https://evil.example.test', env)).toBe(false);
    expect(isOriginAllowed(undefined, env)).toBe(false);
    expect(isOriginAllowed('https://evil.example.test', { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('/ws/brackets end to end', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let base: string;

  beforeAll(async () => {
    server = http.createServer();
    wss = initializeWebSocket(server, { prisma, revalidateIntervalMs: 25 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/brackets`;
  });

  afterAll(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  type Received = { messages: Array<Record<string, unknown>>; closed: Promise<number> };
  function open(url: string, headers: Record<string, string> = {}): { ws: WebSocket } & Received {
    const ws = new WebSocket(url, { headers });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as Record<string, unknown>));
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    return { ws, messages, closed };
  }
  const opened = (ws: WebSocket) => new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(check()).toBe(true);
  };

  it('closes unauthenticated connections with 1008', async () => {
    const conn = open(base);
    expect(await conn.closed).toBe(WS_CLOSE_AUTH_FAILED);
  });

  it('does not accept a token in the query string', async () => {
    const conn = open(`${base}?token=${encodeURIComponent(tokenFor(users.alice))}`);
    expect(await conn.closed).toBe(WS_CLOSE_AUTH_FAILED);
  });

  it('authenticates via the session cookie and delivers updates for an authorized division', async () => {
    const conn = open(base, { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice)}` });
    await opened(conn.ws);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-a', divisionId: 'd-a' }));
    await until(() => conn.messages.some((m) => m.type === 'subscribed'));

    broadcastMatchUpdate('d-a', 'm-1', { score1: '3' });
    await until(() => conn.messages.some((m) => m.type === 'match_updated'));
    expect(conn.messages.find((m) => m.type === 'match_updated')).toMatchObject({ divisionId: 'd-a', matchId: 'm-1' });

    conn.ws.close();
    await conn.closed;
    await until(() => getSubscriptionStats()['d-a'] === undefined);
  });

  it('denies a cross-tenant subscribe with 4403 and never delivers that tenant\'s updates', async () => {
    const conn = open(base, { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice)}` });
    await opened(conn.ws);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-b', divisionId: 'd-b' }));
    expect(await conn.closed).toBe(WS_CLOSE_FORBIDDEN);
    expect(conn.messages).toEqual([{ type: 'subscription_denied', divisionId: 'd-b', reason: 'forbidden' }]);
    expect(getSubscriptionStats()['d-b']).toBeUndefined();
  });

  it('keeps one subscription per socket when a client re-subscribes', async () => {
    const conn = open(base, { authorization: `Bearer ${tokenFor(users.admin)}` });
    await opened(conn.ws);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-a', divisionId: 'd-a' }));
    await until(() => conn.messages.filter((m) => m.type === 'subscribed').length === 1);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-b', divisionId: 'd-b' }));
    await until(() => conn.messages.filter((m) => m.type === 'subscribed').length === 2);
    expect(getSubscriptionStats()).toEqual({ 'd-b': 1 });
    conn.ws.close();
    await conn.closed;
  });
  it('closes a subscribed socket with 4403 once the user loses access to the tournament', async () => {
    const membership = memberships.find((m) => m.userId === 'alice' && m.organizationId === 'org-a')!;
    const conn = open(base, { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice)}` });
    await opened(conn.ws);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-a', divisionId: 'd-a' }));
    await until(() => conn.messages.some((m) => m.type === 'subscribed'));
    // Survives several revalidation ticks while access holds.
    await new Promise((r) => setTimeout(r, 100));
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);

    membership.organizationId = 'org-removed';
    try {
      expect(await conn.closed).toBe(WS_CLOSE_FORBIDDEN);
      expect(conn.messages.at(-1)).toEqual({ type: 'subscription_denied', divisionId: 'd-a', reason: 'revoked' });
      expect(getSubscriptionStats()['d-a']).toBeUndefined();
      broadcastMatchUpdate('d-a', 'm-2', {});
      expect(conn.messages.some((m) => m.matchId === 'm-2')).toBe(false);
    } finally {
      membership.organizationId = 'org-a';
    }
  });

  it('closes with 1008 once the session is revoked (logout / deactivation)', async () => {
    const conn = open(base, { cookie: `${SESSION_COOKIE}=${tokenFor(users.bob)}` });
    await opened(conn.ws);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-b', divisionId: 'd-b' }));
    await until(() => conn.messages.some((m) => m.type === 'subscribed'));
    users.bob.tokenVersion += 1;
    try {
      expect(await conn.closed).toBe(WS_CLOSE_AUTH_FAILED);
      expect(getSubscriptionStats()['d-b']).toBeUndefined();
    } finally {
      users.bob.tokenVersion -= 1;
    }
  });

  it('keeps sockets open through a transient database outage', async () => {
    const conn = open(base, { cookie: `${SESSION_COOKIE}=${tokenFor(users.alice)}` });
    await opened(conn.ws);
    conn.ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-a', divisionId: 'd-a' }));
    await until(() => conn.messages.some((m) => m.type === 'subscribed'));
    throwOnUser = true;
    try {
      await new Promise((r) => setTimeout(r, 120));
    } finally {
      throwOnUser = false;
    }
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
    broadcastMatchUpdate('d-a', 'm-3', {});
    await until(() => conn.messages.some((m) => m.matchId === 'm-3'));
    conn.ws.close();
    await conn.closed;
  });
});

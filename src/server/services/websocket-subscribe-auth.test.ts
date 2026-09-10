/**
 * HIGH #6 (backend review): WebSocket `subscribe` must perform
 * per-resource authorization before joining the local fanout set.
 *
 * Spins up a real `ws` server with a stub Prisma client and a
 * no-op WsPubSub (so this test does not need a live Postgres
 * connection — the SH-6 cross-instance fanout has its own
 * integration test in websocket.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { WebSocket as WsClient } from 'ws';
import { sign } from 'jsonwebtoken';
import {
  initializeWebSocket,
  closeWebSocket,
} from './websocket.js';
import type { WsPubSub } from './ws-pubsub.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-32-characters-min-for-tests';

function makeToken(userId: string, role: string): string {
  // Must match the issuer/audience expected by `verifyToken` in
  // src/server/middleware/auth.ts (which is the actual verifier
  // wired into the WebSocket handshake) — the production
  // token issuer is 'bowin' / 'bowin'.
  return sign(
    { userId, email: `${userId}@test.local`, role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '5m', issuer: 'bowin', audience: 'bowin' },
  );
}

/**
 * In-process WsPubSub stand-in. Records calls so tests can assert
 * the publish path was reached; never opens a socket to Postgres.
 * Matches the surface used by websocket.ts (start / subscribe /
 * unsubscribe / publish / close + EventEmitter `on('message')`).
 */
class FakePubSub extends EventEmitter implements Partial<WsPubSub> {
  start = vi.fn(async () => undefined);
  subscribe = vi.fn(async (_topic: string) => undefined);
  unsubscribe = vi.fn(async (_topic: string) => undefined);
  publish = vi.fn(async (_topic: string, _payload: string) => undefined);
  close = vi.fn(async () => undefined);
}

interface PrismaStubState {
  divisions: Map<string, { tournamentId: string }>;
  accesses: Map<string, Set<string>>; // userId -> set of tournamentIds
}

function makePrismaStub(state: PrismaStubState) {
  return {
    division: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const div = state.divisions.get(where.id);
        return div ? { tournamentId: div.tournamentId } : null;
      }),
    },
    userTournamentAccess: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; tournamentId: string; role: { in: string[] } } }) => {
        const set = state.accesses.get(where.userId);
        if (!set || !set.has(where.tournamentId)) return null;
        return { id: 'access-1' };
      }),
    },
  };
}

interface Rig {
  server: http.Server;
  port: number;
  prisma: ReturnType<typeof makePrismaStub>;
  state: PrismaStubState;
  pubsub: FakePubSub;
}

async function startRig(initial?: Partial<PrismaStubState>): Promise<Rig> {
  const state: PrismaStubState = {
    divisions: initial?.divisions ?? new Map(),
    accesses: initial?.accesses ?? new Map(),
  };
  const prisma = makePrismaStub(state);
  const pubsub = new FakePubSub();
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  await initializeWebSocket(server, {
    pubsub: pubsub as unknown as WsPubSub,
    prisma: prisma as unknown as import('@prisma/client').PrismaClient,
  });
  return { server, port, prisma, state, pubsub };
}

async function stopRig(rig: Rig): Promise<void> {
  await new Promise<void>((resolve) => rig.server.close(() => resolve()));
  await closeWebSocket();
}

interface SubscribeOutcome {
  type: string;
  reason?: string;
  divisionId?: string;
  tournamentId?: string;
  closeCode?: number;
}

async function openAndSubscribe(
  rig: Rig,
  token: string,
  payload: { tournamentId: string; divisionId: string },
): Promise<SubscribeOutcome> {
  const ws = new WsClient(`ws://127.0.0.1:${rig.port}/ws/brackets?token=${encodeURIComponent(token)}`);
  const messages: SubscribeOutcome[] = [];
  const closePromise = new Promise<number>((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // ignore non-JSON
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'subscribe', ...payload }));
  // Wait either for a subscribe-related message or a close.
  await new Promise<void>((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (messages.some((m) => m.type === 'subscribed' || m.type === 'subscription_denied')) {
        resolve();
        return;
      }
      if (Date.now() - start > 2000) {
        resolve();
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
  const closeCode = await Promise.race([
    closePromise,
    new Promise<number>((resolve) => setTimeout(() => resolve(0), 200)),
  ]);
  ws.close();
  return { ...(messages.find((m) => m.type === 'subscribed' || m.type === 'subscription_denied') ?? {}), closeCode };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await closeWebSocket().catch(() => undefined);
});

describe('WebSocket subscribe authorization (HIGH #6)', () => {
  it('allows an admin JWT to subscribe to any tournament/division', async () => {
    const rig = await startRig();
    try {
      const token = makeToken('u-admin', 'admin');
      const outcome = await openAndSubscribe(rig, token, {
        tournamentId: 't-A',
        divisionId: 'd-A',
      });
      expect(outcome.type).toBe('subscribed');
      expect(outcome.divisionId).toBe('d-A');
      expect(rig.prisma.userTournamentAccess.findFirst).not.toHaveBeenCalled();
      expect(rig.prisma.division.findUnique).not.toHaveBeenCalled();
    } finally {
      await stopRig(rig);
    }
  });

  it('allows a non-admin user with a UserTournamentAccess row', async () => {
    const rig = await startRig({
      divisions: new Map([['d-A', { tournamentId: 't-A' }]]),
      accesses: new Map([['u-skipper', new Set(['t-A'])] ]),
    });
    try {
      const token = makeToken('u-skipper', 'scorekeeper');
      const outcome = await openAndSubscribe(rig, token, {
        tournamentId: 't-A',
        divisionId: 'd-A',
      });
      expect(outcome.type).toBe('subscribed');
      expect(rig.prisma.division.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-A' },
        select: { tournamentId: true },
      });
      expect(rig.prisma.userTournamentAccess.findFirst).toHaveBeenCalled();
    } finally {
      await stopRig(rig);
    }
  });

  it('denies a non-admin user with no UserTournamentAccess row', async () => {
    const rig = await startRig({
      divisions: new Map([['d-A', { tournamentId: 't-A' }]]),
      accesses: new Map(),
    });
    try {
      const token = makeToken('u-stranger', 'scorekeeper');
      const outcome = await openAndSubscribe(rig, token, {
        tournamentId: 't-A',
        divisionId: 'd-A',
      });
      expect(outcome.type).toBe('subscription_denied');
      expect(outcome.reason).toBe('forbidden');
      // 4403 mirrors HTTP 403; the ws library may also report
      // 1006 (abnormal closure) once the server-side close
      // reaches the client, so accept either as proof the
      // close was sent.
      expect([4403, 1006]).toContain(outcome.closeCode);
    } finally {
      await stopRig(rig);
    }
  });

  it('denies when the division belongs to a different tournament', async () => {
    const rig = await startRig({
      // Division d-A actually belongs to t-B, but the client
      // claims t-A. The check must reject on tournament mismatch
      // before consulting the access row.
      divisions: new Map([['d-A', { tournamentId: 't-B' }]]),
      // Give the user access to the claimed tournament so the
      // only thing that can deny is the mismatch.
      accesses: new Map([['u-sneaky', new Set(['t-A'])] ]),
    });
    try {
      const token = makeToken('u-sneaky', 'scorekeeper');
      const outcome = await openAndSubscribe(rig, token, {
        tournamentId: 't-A',
        divisionId: 'd-A',
      });
      expect(outcome.type).toBe('subscription_denied');
      expect(outcome.reason).toBe('tournament_mismatch');
      expect(rig.prisma.userTournamentAccess.findFirst).not.toHaveBeenCalled();
    } finally {
      await stopRig(rig);
    }
  });

  it('denies when the division does not exist', async () => {
    const rig = await startRig();
    try {
      const token = makeToken('u-ghost', 'scorekeeper');
      const outcome = await openAndSubscribe(rig, token, {
        tournamentId: 't-A',
        divisionId: 'd-missing',
      });
      expect(outcome.type).toBe('subscription_denied');
      expect(outcome.reason).toBe('division_not_found');
    } finally {
      await stopRig(rig);
    }
  });

  it('denies a viewer-only JWT when no prisma client is provided', async () => {
    // No prisma → fallback path. A viewer-only JWT must be
    // denied so test rigs (and any future code path that
    // forgets to pass prisma) fail closed.
    const pubsub = new FakePubSub();
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      await initializeWebSocket(server, {
        pubsub: pubsub as unknown as WsPubSub,
      });
      const token = makeToken('u-viewer', 'viewer');
      const outcome = await openAndSubscribe(
        { server, port, prisma: undefined as never, state: { divisions: new Map(), accesses: new Map() }, pubsub },
        token,
        { tournamentId: 't-A', divisionId: 'd-A' },
      );
      expect(outcome.type).toBe('subscription_denied');
      expect(outcome.reason).toBe('no_database');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeWebSocket();
    }
  });
});

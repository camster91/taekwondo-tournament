/**
 * End-to-end integration test for SH-6 cross-instance WebSocket fanout.
 *
 * Spins up two real `http.createServer()` instances, wires each to
 * its own `WsPubSub` (simulating two Coolify replicas), and opens a
 * real `ws` client to instance A. A publish that goes through
 * instance B's pubsub must reach the client on instance A — the
 * exact failure mode SH-6 fixes.
 *
 * Skipped when Postgres is unreachable so the suite can run in
 * lanes without a live database.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { WebSocket as WsClient } from 'ws';
import { sign } from 'jsonwebtoken';
import pg from 'pg';
import {
  initializeWebSocket,
  closeWebSocket,
  broadcastMatchUpdate,
  broadcastBracketRegenerated,
} from './websocket.js';
import { WsPubSub } from './ws-pubsub.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://taekwondo:taekwondo@localhost:5432/taekwondo_tournament';
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-32-characters-min-for-tests';

let pgAvailable = false;
let probeClient: pg.Client | null = null;

beforeAll(async () => {
  probeClient = new pg.Client({ connectionString: CONNECTION_STRING });
  try {
    await probeClient.connect();
    pgAvailable = true;
  } catch {
    pgAvailable = false;
    console.warn(
      '[websocket.test] Postgres not reachable — skipping SH-6 cross-instance integration test.',
    );
  } finally {
    if (probeClient && !pgAvailable) {
      await probeClient.end().catch(() => undefined);
      probeClient = null;
    }
  }
}, 10_000);

afterAll(async () => {
  await closeWebSocket().catch(() => undefined);
  if (probeClient) {
    await probeClient.end().catch(() => undefined);
    probeClient = null;
  }
});

interface TestRig {
  server: http.Server;
  port: number;
  pubsub: WsPubSub;
}

async function startRig(): Promise<TestRig> {
  const server = http.createServer();
  const pubsub = new WsPubSub({ connectionString: CONNECTION_STRING });
  await pubsub.start();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  await initializeWebSocket(server, { pubsub });
  return { server, port, pubsub };
}

async function stopRig(rig: TestRig): Promise<void> {
  await new Promise<void>((resolve) => rig.server.close(() => resolve()));
}

function makeToken(userId: string): string {
  return sign(
    { userId, email: `${userId}@test.local`, role: 'viewer' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '5m', issuer: 'tkd-app', audience: 'tkd-app' },
  );
}

interface RecordedMessage {
  raw: string;
  parsed: { type: string; divisionId?: string; matchId?: string; data?: unknown };
}

async function openClient(port: number, token: string, topic: string): Promise<{
  ws: WsClient;
  received: RecordedMessage[];
  waitForType: (type: string, timeoutMs?: number) => Promise<RecordedMessage>;
  close: () => Promise<void>;
}> {
  const ws = new WsClient(`ws://127.0.0.1:${port}/ws/brackets?token=${encodeURIComponent(token)}`);
  const received: RecordedMessage[] = [];
  const waiters: Array<{ type: string; resolve: (m: RecordedMessage) => void }> = [];
  ws.on('message', (data) => {
    const raw = data.toString();
    let parsed: RecordedMessage['parsed'];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const rec: RecordedMessage = { raw, parsed };
    received.push(rec);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.type === rec.parsed.type) {
        waiters[i]!.resolve(rec);
        waiters.splice(i, 1);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'subscribe', tournamentId: 't-1', divisionId: topic }));
  // Wait for the subscribe confirmation so the local LISTEN is in
  // place before we publish.
  await new Promise<RecordedMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for subscribed')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      const rec = { raw: data.toString(), parsed: JSON.parse(data.toString()) };
      if (rec.parsed.type !== 'subscribed') {
        reject(new Error(`expected subscribed, got ${rec.parsed.type}`));
        return;
      }
      received.push(rec);
      resolve(rec);
    });
  });

  return {
    ws,
    received,
    waitForType: (type, timeoutMs = 3000) =>
      new Promise<RecordedMessage>((resolve, reject) => {
        const existing = received.find((m) => m.parsed.type === type);
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
        waiters.push({
          type,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}

describe('WebSocket cross-instance fanout (SH-6)', () => {
  it('delivers a broadcast from instance B to a subscriber on instance A', async () => {
    if (!pgAvailable) return;

    const topic = `sh6-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // rigA: real HTTP server with a real WebSocketServer + its own pubsub.
    // rigB: a second HTTP server with a second pubsub, used as the publisher.
    // The module-level "active pubsub" is whichever rig was initialized
    // LAST — we initialize rigB after rigA so the broadcast helpers
    // publish through rigB's pubsub. The local client is connected to
    // rigA, which has its own LISTEN on the same topic. The cross-
    // instance delivery path is:
    //   broadcastMatchUpdate -> rigB.pubsub.publish -> Postgres NOTIFY
    //   -> rigA.pubsub 'message' event -> rigA's local fanout -> client.
    const rigA = await startRig();
    const rigB = await startRig();
    try {
      const token = makeToken('u-sh6-test');
      const client = await openClient(rigA.port, token, topic);

      // Now broadcast through rigB (the active module-level pubsub).
      broadcastMatchUpdate(topic, 'm-1', { score1: 3, score2: 1, status: 'in_progress' });

      const matchMsg = await client.waitForType('match_updated');
      expect(matchMsg.parsed.divisionId).toBe(topic);
      expect(matchMsg.parsed.matchId).toBe('m-1');
      expect(matchMsg.parsed.data).toEqual({ score1: 3, score2: 1, status: 'in_progress' });

      // bracket_regenerated takes the same path.
      broadcastBracketRegenerated(topic);
      const regenMsg = await client.waitForType('bracket_regenerated');
      expect(regenMsg.parsed.divisionId).toBe(topic);

      await client.close();
    } finally {
      await stopRig(rigA);
      await stopRig(rigB);
      await closeWebSocket();
    }
  }, 20_000);
});

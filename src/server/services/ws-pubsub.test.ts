/**
 * Cross-instance WebSocket pubsub (SH-6) integration test.
 *
 * Verifies the contract: a NOTIFY published on `WsPubSub` instance B
 * is delivered as a `message` event on `WsPubSub` instance A when A
 * has subscribed to the same topic. This is the single guarantee the
 * in-process `Map<topic, Set<connection>>` could not provide.
 *
 * Skipped when Postgres is unreachable so the test doesn't fail in
 * unit-test-only CI lanes. The vitest config already stubs
 * `DATABASE_URL`; the skip only triggers when the connect actually
 * fails.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { WsPubSub } from './ws-pubsub.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://taekwondo:taekwondo@localhost:5432/taekwondo_tournament';

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
      '[ws-pubsub.test] Postgres not reachable at ' +
        CONNECTION_STRING.replace(/:[^:@/]+@/, ':***@') +
        ' — skipping SH-6 cross-instance integration test.',
    );
  } finally {
    if (probeClient && !pgAvailable) {
      await probeClient.end().catch(() => undefined);
      probeClient = null;
    }
  }
}, 10_000);

afterAll(async () => {
  if (probeClient) {
    await probeClient.end().catch(() => undefined);
    probeClient = null;
  }
});

describe('WsPubSub (SH-6 cross-instance fanout)', () => {
  // Use a unique topic per test so a NOTIFY from a leftover instance
  // in a previous run can't pollute the result.
  const makeTopic = (label: string) =>
    `sh6-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  it('delivers a NOTIFY from instance B to a listener on instance A', async () => {
    if (!pgAvailable) return;

    const topic = makeTopic('cross-instance');
    const instanceA = new WsPubSub({ connectionString: CONNECTION_STRING });
    const instanceB = new WsPubSub({ connectionString: CONNECTION_STRING });

    try {
      await Promise.all([instanceA.start(), instanceB.start()]);
      await instanceA.subscribe(topic);

      const received: Array<{ topic: string; payload: string }> = [];
      const ready = new Promise<void>((resolve) => {
        instanceA.on('message', (t, p) => {
          if (t !== topic) return;
          received.push({ topic: t, payload: p });
          resolve();
        });
      });

      const payload = JSON.stringify({ type: 'match_updated', divisionId: topic, matchId: 'm1' });
      await instanceB.publish(topic, payload);

      // The LISTEN client delivers notifications asynchronously; cap
      // the wait at 3s so a stuck connection doesn't hang the suite.
      await Promise.race([
        ready,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('timeout waiting for cross-instance NOTIFY')), 3000),
        ),
      ]);

      expect(received).toHaveLength(1);
      expect(received[0]?.topic).toBe(topic);
      expect(received[0]?.payload).toBe(payload);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('does not deliver NOTIFYs to an instance that has not subscribed', async () => {
    if (!pgAvailable) return;

    const topic = makeTopic('isolated');
    const subscribed = new WsPubSub({ connectionString: CONNECTION_STRING });
    const other = new WsPubSub({ connectionString: CONNECTION_STRING });

    try {
      await Promise.all([subscribed.start(), other.start()]);
      await subscribed.subscribe(topic);

      // The 'other' instance has NOT subscribed. It must not receive
      // a message event for our topic.
      let stray = false;
      other.on('message', (t) => {
        if (t === topic) stray = true;
      });

      await subscribed.publish(topic, JSON.stringify({ type: 'bracket_regenerated', divisionId: topic }));

      // Give the listener a moment to (not) fire.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(stray).toBe(false);
    } finally {
      await subscribed.close();
      await other.close();
    }
  });

  it('isolates different topics', async () => {
    if (!pgAvailable) return;

    const topicA = makeTopic('multi-a');
    const topicB = makeTopic('multi-b');
    const instance = new WsPubSub({ connectionString: CONNECTION_STRING });

    try {
      await instance.start();
      await instance.subscribe(topicA);
      // Deliberately do NOT subscribe to topicB.

      const seenOnA: string[] = [];
      const seenOnB: string[] = [];
      instance.on('message', (t, p) => {
        if (t === topicA) seenOnA.push(p);
        if (t === topicB) seenOnB.push(p);
      });

      await instance.publish(topicA, JSON.stringify({ k: 'a' }));
      await instance.publish(topicB, JSON.stringify({ k: 'b' }));

      const ready = new Promise<void>((resolve) => {
        const start = Date.now();
        const tick = () => {
          if (seenOnA.length > 0) return resolve();
          if (Date.now() - start > 3000) resolve();
          else setTimeout(tick, 25);
        };
        tick();
      });
      await ready;

      expect(seenOnA).toEqual([JSON.stringify({ k: 'a' })]);
      expect(seenOnB).toEqual([]);
    } finally {
      await instance.close();
    }
  });

  it('rejects subscribe/publish after close', async () => {
    if (!pgAvailable) return;

    const instance = new WsPubSub({ connectionString: CONNECTION_STRING });
    await instance.start();
    await instance.close();

    await expect(instance.subscribe(makeTopic('closed'))).rejects.toThrow(/closed/i);
    await expect(instance.publish(makeTopic('closed'), 'x')).rejects.toThrow(/closed/i);

    // close() must be idempotent.
    await instance.close();
  });
});

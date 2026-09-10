import pg from 'pg';
import { EventEmitter } from 'node:events';

/**
 * Cross-instance WebSocket pubsub layer (SH-6 fix).
 *
 * Why Postgres LISTEN/NOTIFY:
 * - The project already runs Postgres (no new infra dependency).
 * - The single-process `Map<topic, Set<connection>>` in `websocket.ts`
 *   means a publish on instance A never reaches a connection on
 *   instance B. With Docker replicas on the roadmap, live bracket
 *   updates would silently disagree between instances.
 * - LISTEN/NOTIFY is per-connection state, so we must use a *dedicated*
 *   long-lived `pg.Client` (not Prisma's pool — pooled connections
 *   rotate and the listener would drop). Publishes use a small
 *   separate pool so they don't block the LISTEN event stream.
 *
 * Channel naming:
 * - Postgres channel identifiers fold to lowercase unless double-quoted
 *   and cap at 63 chars. We use `bowin_ws_<topic>` and always quote the
 *   full name in SQL so a topic that contains uppercase or punctuation
 *   survives the round trip.
 */
const CHANNEL_PREFIX = 'bowin_ws_';

export function channelFor(topic: string): string {
  return `${CHANNEL_PREFIX}${topic}`;
}

export function topicFrom(channel: string): string | null {
  if (!channel.startsWith(CHANNEL_PREFIX)) return null;
  return channel.slice(CHANNEL_PREFIX.length);
}

export interface WsPubSubOptions {
  connectionString: string;
  /**
   * Pool size for NOTIFY publishes. The LISTEN path uses a dedicated
   * single client, so the publish pool just needs to be small. 2 is
   * plenty for the bracket fanout path (one publish per HTTP request
   * that mutates a match).
   */
  publishPoolMax?: number;
}

export interface WsPubSubEvents {
  message: (topic: string, payload: string) => void;
  error: (err: Error) => void;
}

/**
 * EventEmitter shape for the WsPubSub class. Without this declaration
 * the inherited `on`/`off`/`emit` types from EventEmitter lose their
 * generic payload, so we re-declare it.
 */
export declare interface WsPubSub {
  on<U extends keyof WsPubSubEvents>(event: U, listener: WsPubSubEvents[U]): this;
  off<U extends keyof WsPubSubEvents>(event: U, listener: WsPubSubEvents[U]): this;
  emit<U extends keyof WsPubSubEvents>(
    event: U,
    ...args: Parameters<WsPubSubEvents[U]>
  ): boolean;
}

/**
 * Cross-instance pubsub backed by Postgres LISTEN/NOTIFY.
 *
 * Lifecycle:
 *   const ps = new WsPubSub({ connectionString });
 *   await ps.start();          // connects the LISTEN client
 *   await ps.subscribe(topic); // LISTEN bowin_ws_<topic>
 *   await ps.publish(topic, payload); // NOTIFY bowin_ws_<topic>, payload
 *   await ps.close();          // ends both clients
 *
 * A `message` event fires on this instance for every NOTIFY the
 * dedicated listener receives — including ones this instance itself
 * published, which lets a single fanout code path handle both
 * local-loopback and cross-instance traffic.
 */
export class WsPubSub extends EventEmitter {
  private readonly pool: pg.Pool;
  private readonly listener: pg.Client;
  private closed = false;
  private started = false;

  constructor(opts: WsPubSubOptions) {
    super();
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.publishPoolMax ?? 2,
    });
    this.listener = new pg.Client({ connectionString: opts.connectionString });

    this.listener.on('notification', (msg) => {
      const topic = topicFrom(msg.channel ?? '');
      if (!topic || !msg.payload) return;
      this.emit('message', topic, msg.payload);
    });

    this.listener.on('error', (err: Error) => {
      // The listener client is the long-lived LISTEN socket. An error
      // here means the connection died; surface it so the caller can
      // log + restart. We don't auto-reconnect — the caller's graceful
      // shutdown path is the right place to decide what to do.
      this.emit('error', err);
    });

    this.pool.on('error', (err: Error) => {
      // Idle pool clients can emit 'error' if Postgres closes the
      // socket. Don't crash the process; the next publish will grab
      // a fresh client.
      this.emit('error', err);
    });
  }

  /**
   * Open the dedicated LISTEN client. Must be called before subscribe/publish.
   */
  async start(): Promise<void> {
    if (this.started) return;
    await this.listener.connect();
    this.started = true;
  }

  /**
   * Subscribe to a topic (LISTEN). Safe to call repeatedly — callers
   * are expected to ref-count on their side so we LISTEN once per
   * active subscription cluster.
   */
  async subscribe(topic: string): Promise<void> {
    this.assertOpen();
    // Always quote the channel name; pg would otherwise fold the
    // identifier to lowercase and break topics with non-lowercase chars.
    await this.listener.query(`LISTEN "${channelFor(topic)}"`);
  }

  /**
   * Unsubscribe from a topic (UNLISTEN).
   */
  async unsubscribe(topic: string): Promise<void> {
    if (this.closed || !this.started) return;
    await this.listener.query(`UNLISTEN "${channelFor(topic)}"`);
  }

  /**
   * Publish a payload to a topic. Uses the pool so the LISTEN client's
   * notification stream isn't blocked by a slow NOTIFY round trip.
   */
  async publish(topic: string, payload: string): Promise<void> {
    this.assertOpen();
    // pg_notify takes the channel name and payload as text parameters,
    // which avoids identifier escaping and any SQL injection concern.
    // Postgres caps NOTIFY payloads at 8000 bytes — surface a clear
    // log line if we approach the limit so the operator can act before
    // a publish starts failing.
    if (Buffer.byteLength(payload, 'utf8') > 7500) {
      console.warn(
        `[ws-pubsub] NOTIFY payload for topic ${topic} is ${Buffer.byteLength(payload, 'utf8')} bytes; Postgres caps payloads at 8000 bytes.`,
      );
    }
    await this.pool.query('SELECT pg_notify($1, $2)', [channelFor(topic), payload]);
  }

  /**
   * Shut down the pubsub. Idempotent; safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const listenerErr = await this.listener.end().catch((err: unknown) => err);
    if (listenerErr) {
      console.error('[ws-pubsub] error ending listener client:', listenerErr);
    }
    const poolErr = await this.pool.end().catch((err: unknown) => err);
    if (poolErr) {
      console.error('[ws-pubsub] error ending publish pool:', poolErr);
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('WsPubSub is closed');
    }
    if (!this.started) {
      throw new Error('WsPubSub.start() must be called before subscribe/publish');
    }
  }
}

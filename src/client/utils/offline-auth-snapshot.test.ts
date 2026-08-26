import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth-session.js';
import { bootstrapAuthenticatedIdentity, createOfflineAuthSnapshotStore } from './offline-auth-snapshot.js';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

const user: AuthUser & { offlineCapability?: string } = {
  id: 'user-1', email: 'operator@example.com', firstName: 'Venue', lastName: 'Operator', role: 'scorekeeper',
};
const capability = 'server-signed-capability';
const verifier = async (value: string) => value === capability ? user : undefined;

describe('offline authenticated identity snapshot', () => {
  it('restores only a server-signed identity capability', async () => {
    const storage = memoryStorage();
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const store = createOfflineAuthSnapshotStore(storage, verifier, () => now);
    store.save(capability);
    await expect(store.read()).resolves.toEqual(expect.objectContaining({ user }));
    storage.setItem('bowin_offline_auth_v2', JSON.stringify({ version: 2, capability: 'tampered' }));
    await expect(store.read()).resolves.toBeUndefined();
  });

  it('rejects unsigned legacy identity objects', async () => {
    const storage = memoryStorage();
    const store = createOfflineAuthSnapshotStore(storage, verifier);
    storage.setItem('bowin_offline_auth_v1', JSON.stringify({ version: 1, user: { ...user, role: 'admin' } }));
    await expect(store.read()).resolves.toBeUndefined();
  });

  it('clears the snapshot explicitly', async () => {
    const storage = memoryStorage();
    const store = createOfflineAuthSnapshotStore(storage, verifier);
    store.save(capability);
    store.clear();
    await expect(store.read()).resolves.toBeUndefined();
  });

  it('saves validated network identity and restores it only for outage failures', async () => {
    const storage = memoryStorage();
    const store = createOfflineAuthSnapshotStore(storage, verifier);
    expect(await bootstrapAuthenticatedIdentity(async () => new Response(JSON.stringify({ ...user, offlineCapability: capability }), { status: 200 }), store))
      .toEqual({ user, source: 'network' });
    expect(await bootstrapAuthenticatedIdentity(async () => { throw new TypeError('offline'); }, store))
      .toEqual({ user, source: 'offline_snapshot' });
    expect(await bootstrapAuthenticatedIdentity(async () => new Response('unavailable', { status: 503 }), store))
      .toEqual({ user, source: 'offline_snapshot' });
  });

  it('fails closed and clears the snapshot after a confirmed unauthenticated response', async () => {
    const storage = memoryStorage();
    const store = createOfflineAuthSnapshotStore(storage, verifier);
    store.save(capability);
    expect(await bootstrapAuthenticatedIdentity(async () => new Response('', { status: 401 }), store))
      .toEqual({ user: null, source: 'anonymous', clearedOwnerId: user.id });
    await expect(store.read()).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { createVenueDataSnapshotStore, loadVenueData, VenueDataUnavailableError } from './venue-data-snapshot.js';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

const scope = { ownerId: 'user-1', tournamentId: 'tournament-1', kind: 'checkin' as const };
const valid = (value: unknown): value is Array<{ id: string }> => Array.isArray(value)
  && value.every((item) => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'));

describe('scoped venue data snapshot', () => {
  it('restores only matching, unexpired, runtime-validated data', () => {
    const storage = memoryStorage();
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const store = createVenueDataSnapshotStore(storage, () => now);
    store.save(scope, [{ id: 'registration-1' }]);
    expect(store.read(scope, valid)).toEqual(expect.objectContaining({ data: [{ id: 'registration-1' }] }));
    expect(store.read({ ...scope, ownerId: 'user-2' }, valid)).toBeUndefined();
    expect(createVenueDataSnapshotStore(storage, () => now + (12 * 60 * 60 * 1000) + 1).read(scope, valid)).toBeUndefined();
  });

  it('uses a snapshot for network and server outages but not access withdrawal', async () => {
    const store = createVenueDataSnapshotStore(memoryStorage());
    store.save(scope, [{ id: 'registration-1' }]);
    expect(await loadVenueData({ scope, store, validate: valid, request: async () => { throw new TypeError('offline'); } }))
      .toEqual(expect.objectContaining({ source: 'snapshot', data: [{ id: 'registration-1' }] }));
    expect(await loadVenueData({ scope, store, validate: valid, request: async () => new Response('', { status: 503 }) }))
      .toEqual(expect.objectContaining({ source: 'snapshot' }));
    await expect(loadVenueData({ scope, store, validate: valid, request: async () => new Response('', { status: 401 }) }))
      .rejects.toMatchObject({ status: 401 });
    await expect(loadVenueData({ scope, store, validate: valid, request: async () => { throw new TypeError('offline'); } }))
      .rejects.toBeInstanceOf(VenueDataUnavailableError);
  });

  it('purges every snapshot owned by a signed-out operator without touching another owner', () => {
    const store = createVenueDataSnapshotStore(memoryStorage());
    store.save(scope, [{ id: 'registration-1' }]);
    const scoreScope = { ...scope, kind: 'scorekeeper' as const };
    store.save(scoreScope, [{ id: 'division-1' }]);
    const otherScope = { ...scope, ownerId: 'user-2' };
    store.save(otherScope, [{ id: 'other' }]);
    store.clearOwner('user-1');
    expect(store.read(scope, valid)).toBeUndefined();
    expect(store.read(scoreScope, valid)).toBeUndefined();
    expect(store.read(otherScope, valid)).toBeDefined();
  });

  it('saves validated network data and rejects malformed or missing fallback data', async () => {
    const store = createVenueDataSnapshotStore(memoryStorage());
    expect(await loadVenueData({
      scope, store, validate: valid,
      request: async () => new Response(JSON.stringify([{ id: 'registration-2' }]), { status: 200 }),
    })).toEqual(expect.objectContaining({ source: 'network', data: [{ id: 'registration-2' }] }));
    await expect(loadVenueData({
      scope: { ...scope, tournamentId: 'other' }, store, validate: valid,
      request: async () => new Response(JSON.stringify({ error: 'bad shape' }), { status: 200 }),
    })).rejects.toBeInstanceOf(VenueDataUnavailableError);
  });
});

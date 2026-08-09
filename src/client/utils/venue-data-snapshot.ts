const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type VenueDataKind = 'checkin' | 'scorekeeper' | 'tournament';
export interface VenueDataScope { ownerId: string; tournamentId: string; kind: VenueDataKind }

interface VenueDataSnapshot<T> extends VenueDataScope {
  version: 1;
  savedAt: string;
  expiresAt: string;
  data: T;
}

export class VenueDataUnavailableError extends Error {
  constructor(message = 'No validated venue data is available on this device', public readonly status?: number) {
    super(message);
    this.name = 'VenueDataUnavailableError';
  }
}

function keyFor(scope: VenueDataScope): string {
  return `bowin_venue_snapshot_v1:${scope.ownerId}:${scope.tournamentId}:${scope.kind}`;
}

export function createVenueDataSnapshotStore(storage: Storage, now: () => number = Date.now) {
  return {
    save<T>(scope: VenueDataScope, data: T): boolean {
      const savedAt = now();
      const snapshot: VenueDataSnapshot<T> = {
        version: 1, ...scope, data,
        savedAt: new Date(savedAt).toISOString(),
        expiresAt: new Date(savedAt + MAX_AGE_MS).toISOString(),
      };
      try {
        storage.setItem(keyFor(scope), JSON.stringify(snapshot));
        return true;
      } catch {
        return false;
      }
    },

    read<T>(scope: VenueDataScope, validate: (value: unknown) => value is T): VenueDataSnapshot<T> | undefined {
      const key = keyFor(scope);
      try {
        const raw = storage.getItem(key);
        if (!raw) return undefined;
        const value = JSON.parse(raw) as Partial<VenueDataSnapshot<unknown>>;
        const savedAt = typeof value.savedAt === 'string' ? Date.parse(value.savedAt) : Number.NaN;
        const expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN;
        if (value.version !== 1 || value.ownerId !== scope.ownerId || value.tournamentId !== scope.tournamentId
          || value.kind !== scope.kind || !Number.isFinite(savedAt) || !Number.isFinite(expiresAt)
          || savedAt > now() || expiresAt <= now() || expiresAt - savedAt > MAX_AGE_MS || !validate(value.data)) {
          storage.removeItem(key);
          return undefined;
        }
        return value as VenueDataSnapshot<T>;
      } catch {
        try { storage.removeItem(key); } catch { /* fail closed */ }
        return undefined;
      }
    },

    clear(scope: VenueDataScope): void {
      try { storage.removeItem(keyFor(scope)); } catch { /* best effort */ }
    },

    clearOwner(ownerId: string): void {
      try {
        const prefix = `bowin_venue_snapshot_v1:${ownerId}:`;
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
          .filter((key): key is string => Boolean(key?.startsWith(prefix)));
        keys.forEach((key) => storage.removeItem(key));
      } catch { /* best effort */ }
    },
  };
}

type VenueDataStore = ReturnType<typeof createVenueDataSnapshotStore>;

export async function loadVenueData<T>({
  scope, store, validate, request,
}: {
  scope: VenueDataScope;
  store: VenueDataStore;
  validate: (value: unknown) => value is T;
  request: () => Promise<Response>;
}): Promise<{ data: T; source: 'network' | 'snapshot'; savedAt: string }> {
  let fallbackAllowed = false;
  try {
    const response = await request();
    if (response.ok) {
      const value: unknown = await response.json().catch(() => undefined);
      if (!validate(value)) throw new VenueDataUnavailableError('Venue data response was malformed', response.status);
      const savedAt = new Date().toISOString();
      store.save(scope, value);
      return { data: value, source: 'network', savedAt };
    }
    fallbackAllowed = response.status === 429 || response.status >= 500;
    if (!fallbackAllowed) {
      store.clear(scope);
      throw new VenueDataUnavailableError(`Venue data request failed (${response.status})`, response.status);
    }
  } catch (error) {
    if (error instanceof VenueDataUnavailableError) throw error;
    fallbackAllowed = true;
  }

  if (fallbackAllowed) {
    const snapshot = store.read(scope, validate);
    if (snapshot) return { data: snapshot.data, source: 'snapshot', savedAt: snapshot.savedAt };
  }
  throw new VenueDataUnavailableError();
}

export function browserVenueDataSnapshotStore() {
  return createVenueDataSnapshotStore(window.localStorage);
}

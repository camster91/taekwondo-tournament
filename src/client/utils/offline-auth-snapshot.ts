import { isAuthUser, type AuthUser } from './auth-session.js';
import { verifyOfflineCapability } from './offline-capability.js';

const STORAGE_KEY = 'bowin_offline_auth_v2';
const LEGACY_STORAGE_KEY = 'bowin_offline_auth_v1';

interface OfflineAuthSnapshot {
  version: 2;
  capability: string;
}

type CapabilityVerifier = (capability: string) => Promise<AuthUser | undefined>;

export function createOfflineAuthSnapshotStore(
  storage: Storage,
  verify: CapabilityVerifier,
  _now: () => number = Date.now,
) {
  return {
    save(capability: string): boolean {
      if (!capability) return false;
      try {
        storage.removeItem(LEGACY_STORAGE_KEY);
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, capability } satisfies OfflineAuthSnapshot));
        return true;
      } catch {
        return false;
      }
    },

    async read(): Promise<{ user: AuthUser } | undefined> {
      try {
        storage.removeItem(LEGACY_STORAGE_KEY);
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return undefined;
        const value = JSON.parse(raw) as Partial<OfflineAuthSnapshot>;
        if (value.version !== 2 || typeof value.capability !== 'string') {
          storage.removeItem(STORAGE_KEY);
          return undefined;
        }
        const user = await verify(value.capability);
        if (!user) {
          storage.removeItem(STORAGE_KEY);
          return undefined;
        }
        return { user };
      } catch {
        try { storage.removeItem(STORAGE_KEY); } catch { /* fail closed */ }
        return undefined;
      }
    },

    clear(): void {
      try {
        storage.removeItem(STORAGE_KEY);
        storage.removeItem(LEGACY_STORAGE_KEY);
      } catch { /* local clear is best effort */ }
    },
  };
}

export function browserOfflineAuthSnapshotStore() {
  const publicKey = import.meta.env.VITE_OFFLINE_CAPABILITY_PUBLIC_KEY_BASE64 || '';
  return createOfflineAuthSnapshotStore(
    window.localStorage,
    (capability) => verifyOfflineCapability(capability, publicKey),
  );
}

type OfflineAuthStore = ReturnType<typeof createOfflineAuthSnapshotStore>;

export async function bootstrapAuthenticatedIdentity(
  request: () => Promise<Response>,
  store: OfflineAuthStore,
): Promise<{ user: AuthUser | null; source: 'network' | 'offline_snapshot' | 'anonymous'; clearedOwnerId?: string }> {
  const priorSnapshot = await store.read();
  try {
    const response = await request();
    if (response.ok) {
      const value: unknown = await response.json().catch(() => undefined);
      if (!isAuthUser(value)) {
        store.clear();
        return {
          user: null,
          source: 'anonymous',
          ...(priorSnapshot?.user.id ? { clearedOwnerId: priorSnapshot.user.id } : {}),
        };
      }
      const record = value as AuthUser & { offlineCapability?: unknown };
      if (typeof record.offlineCapability === 'string') store.save(record.offlineCapability);
      else store.clear();
      const { offlineCapability: _capability, ...user } = record;
      return {
        user,
        source: 'network',
        ...(priorSnapshot?.user.id && priorSnapshot.user.id !== user.id
          ? { clearedOwnerId: priorSnapshot.user.id }
          : {}),
      };
    }
    if (response.status < 500 && response.status !== 429) {
      store.clear();
      return {
        user: null,
        source: 'anonymous',
        ...(priorSnapshot?.user.id ? { clearedOwnerId: priorSnapshot.user.id } : {}),
      };
    }
  } catch {
    // Network failure may use a short-lived, server-signed identity capability.
  }

  return priorSnapshot
    ? { user: priorSnapshot.user, source: 'offline_snapshot' }
    : { user: null, source: 'anonymous' };
}

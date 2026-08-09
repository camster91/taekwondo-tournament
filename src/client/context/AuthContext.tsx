import { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, ReactNode } from 'react';
import { browserSessionEvidence } from '../utils/session-evidence';
import { hydrateVerifiedSession, isAuthUser, SessionHydrationError, type AuthUser as User } from '../utils/auth-session';
import { bootstrapAuthenticatedIdentity, browserOfflineAuthSnapshotStore } from '../utils/offline-auth-snapshot';
import { browserVenueDataSnapshotStore } from '../utils/venue-data-snapshot';
import { browserOfflineOperationQueue } from '../utils/offline-operation-queue';
import { purgeOfflineOwnerData } from '../utils/offline-owner-data';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOfflineSession: boolean;
  requestMagicLink: (email: string) => Promise<{ success: boolean; error?: string; devMode?: boolean; magicUrl?: string; code?: string }>;
  verifyCode: (email: string, code: string) => Promise<VerificationResult>;
  verifyToken: (token: string) => Promise<VerificationResult>;
  retrySessionHydration: () => Promise<VerificationResult>;
  // Hydrate React state from a complete session payload (e.g. accept-invite).
  // Prefer verifyCode/verifyToken when the caller only has email + OTP.
  login: (data: { user: User }) => void;
  logout: () => Promise<void>;
  hasRole: (roles: string[]) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Auth is now cookie-based. The HttpOnly `bowin_session` cookie is set
 * by the server on every successful login (magic-link, demo, accept-
 * invite, etc.). Same-origin browser requests auto-attach the cookie,
 * so client code no longer reads, stores, or sends the JWT — it just
 * asks /api/auth/me on mount to learn who the cookie authenticates as.
 *
 * getAuthHeaders() below is kept as a no-op for backward compatibility
 * with existing callers; the cookie is what actually authenticates.
 */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const sessionEvidence = useMemo(browserSessionEvidence, []);
  const offlineAuth = useMemo(browserOfflineAuthSnapshotStore, []);
  const venueSnapshots = useMemo(browserVenueDataSnapshotStore, []);
  const offlineOperations = useMemo(browserOfflineOperationQueue, []);
  const previousOwnerId = useRef<string | null>(null);
  const authGeneration = useRef(0);
  const saveOfflineCapability = useCallback((value: User) => {
    const capability = (value as User & { offlineCapability?: unknown }).offlineCapability;
    if (typeof capability === 'string') offlineAuth.save(capability);
  }, [offlineAuth]);

  useEffect(() => {
    const nextOwnerId = user?.id ?? null;
    if (previousOwnerId.current && previousOwnerId.current !== nextOwnerId) {
      purgeOfflineOwnerData(previousOwnerId.current, venueSnapshots, offlineOperations);
    }
    previousOwnerId.current = nextOwnerId;
  }, [offlineOperations, user?.id, venueSnapshots]);

  // Hydrate from the cookie session on mount.
  useEffect(() => {
    let cancelled = false;
    const bootstrapGeneration = authGeneration.current;
    (async () => {
      try {
        let confirmedUnauthenticated = false;
        const result = await bootstrapAuthenticatedIdentity(async () => {
          const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
          confirmedUnauthenticated = response.status === 401;
          return response;
        }, offlineAuth);
        if (!cancelled && bootstrapGeneration === authGeneration.current) {
          if (result.clearedOwnerId) {
            purgeOfflineOwnerData(result.clearedOwnerId, venueSnapshots, offlineOperations);
          }
          setUser(result.user);
          setIsOfflineSession(result.source === 'offline_snapshot');
          if (result.source === 'network') sessionEvidence.markAuthenticated();
          if (confirmedUnauthenticated) {
            // Stale / invalid cookie — clear any lingering local state and
            // notify the rest of the app (ToastContext listens for this).
            if (typeof window !== 'undefined' && sessionEvidence.consumeExpiredSessionEvidence()) {
              window.dispatchEvent(new CustomEvent('session-expired'));
            }
          }
        }
      } catch {
        // Network error — leave user null, isLoading false.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offlineAuth, offlineOperations, sessionEvidence, venueSnapshots]);

  // Global 401 → "session expired" event. Patches fetch so any API call
  // that returns 401 fires the same CustomEvent (consumed by
  // ToastContext) and clears local state. This catches the case where
  // the cookie is invalidated mid-session (admin deactivates the
  // user, role changes, tokenVersion bump) and the page has not been
  // remounted.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.status === 401) {
        const url = typeof args[0] === 'string'
          ? args[0]
          : (args[0] as Request)?.url ?? '';
        // Don't fire on the auth endpoints themselves — they're the source
        // of the 401 (e.g. wrong password, used code, etc.).
        if (
          !url.includes('/api/auth/me') &&
          !url.includes('/api/auth/login') &&
          !url.includes('/api/auth/verify-magic-link') &&
          !url.includes('/api/auth/request-magic-link') &&
          !url.includes('/api/auth/dev-token') &&
          !url.includes('/api/auth/demo') &&
          !url.includes('/api/auth/setup')
        ) {
          setUser((current) => {
            if (current) {
              sessionEvidence.clear();
              offlineAuth.clear();
              setIsOfflineSession(false);
              window.dispatchEvent(new CustomEvent('session-expired'));
            }
            return null;
          });
        }
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [offlineAuth, sessionEvidence]);

  const login = (data: { user: User }) => {
    authGeneration.current += 1;
    setUser(data.user);
    setIsOfflineSession(false);
    sessionEvidence.markAuthenticated();
  };

  const requestMagicLink = async (email: string) => {
    try {
      const res = await fetch('/api/auth/request-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to send sign-in link' };
      }

      if (data.devMode) {
        return {
          success: true,
          devMode: true,
          magicUrl: data.magicUrl,
          code: data.code,
        };
      }

      return { success: true };
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const retrySessionHydration = async (): Promise<VerificationResult> => {
    try {
      const userData = await hydrateVerifiedSession();
      setUser(userData);
      setIsOfflineSession(false);
      saveOfflineCapability(userData);
      sessionEvidence.markAuthenticated();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        sessionVerified: true,
        error: error instanceof SessionHydrationError ? error.message : 'Network error. Please try again.',
      };
    }
  };

  const verifyCode = async (email: string, code: string) => {
    try {
      const res = await fetch('/api/auth/verify-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, code }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || 'Verification failed' };
      }

      // Verification is not complete from the UI's perspective until the
      // cookie-backed session can be loaded and validated.
      authGeneration.current += 1;
      return await retrySessionHydration();
    } catch (error) {
      return {
        success: false,
        sessionVerified: error instanceof SessionHydrationError,
        error: error instanceof SessionHydrationError ? error.message : 'Network error. Please try again.',
      };
    }
  };

  const verifyToken = async (magicToken: string) => {
    try {
      const res = await fetch('/api/auth/verify-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: magicToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || 'Verification failed' };
      }

      authGeneration.current += 1;
      return await retrySessionHydration();
    } catch (error) {
      return {
        success: false,
        sessionVerified: error instanceof SessionHydrationError,
        error: error instanceof SessionHydrationError ? error.message : 'Network error. Please try again.',
      };
    }
  };

  const logout = async () => {
    // Server bumps tokenVersion and clears the cookie. Even if this
    // request fails, the next API call would 401 anyway — but we
    // optimistically clear local state too.
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // Ignore network errors — local clear below is enough to stop
      // the UI from acting as if the user is still signed in.
    }
    authGeneration.current += 1;
    setUser(null);
    setIsOfflineSession(false);
    offlineAuth.clear();
    sessionEvidence.clear();
  };

  const hasRole = (roles: string[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const userData: unknown = await res.json();
        if (!isAuthUser(userData)) return;
        setUser(userData);
        setIsOfflineSession(false);
          saveOfflineCapability(userData);
        sessionEvidence.markAuthenticated();
      } else if (res.status === 401) {
        setUser(null);
        setIsOfflineSession(false);
        offlineAuth.clear();
      }
    } catch {
      // Network error — leave state alone.
    }
  }, [offlineAuth, saveOfflineCapability, sessionEvidence]);

  useEffect(() => {
    const handleOnline = () => { void refreshUser(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isOfflineSession,
        requestMagicLink,
        verifyCode,
        verifyToken,
        retrySessionHydration,
        login,
        logout,
        hasRole,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// CSRF double-submit: read the readable `bowin_csrf` cookie and send
// it as X-CSRF-Token on mutating requests. Cookie auth alone is not
// enough — without this header a cross-site form could trigger
// state-changing requests (mitigated partly by SameSite=Lax).
export function getAuthHeaders(): HeadersInit {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(/(?:^|;\s*)bowin_csrf=([^;]*)/);
  const csrf = match ? decodeURIComponent(match[1]) : '';
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

interface VerificationResult {
  success: boolean;
  error?: string;
  sessionVerified?: boolean;
}

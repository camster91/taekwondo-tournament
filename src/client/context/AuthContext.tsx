import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { browserSessionEvidence } from '../utils/session-evidence';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'director' | 'scorekeeper' | 'viewer';
  createdAt?: string;
  isDemo?: boolean;
  demoExpiresAt?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestMagicLink: (email: string) => Promise<{ success: boolean; error?: string; devMode?: boolean; magicUrl?: string; code?: string }>;
  verifyCode: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  verifyToken: (token: string) => Promise<{ success: boolean; error?: string }>;
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
  const sessionEvidence = useMemo(browserSessionEvidence, []);

  // Hydrate from the cookie session on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!cancelled) {
          if (res.ok) {
            const userData = (await res.json()) as User;
            setUser(userData);
            sessionEvidence.markAuthenticated();
          } else if (res.status === 401) {
            // Stale / invalid cookie — clear any lingering local state and
            // notify the rest of the app (ToastContext listens for this).
            setUser(null);
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
  }, []);

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
  }, []);

  const login = (data: { user: User }) => {
    setUser(data.user);
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

      // Cookie is set by the server. Fetch /me to hydrate state.
      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (meRes.ok) {
        const userData = (await meRes.json()) as User;
        setUser(userData);
        sessionEvidence.markAuthenticated();
      }
      return { success: true };
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
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

      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (meRes.ok) {
        const userData = (await meRes.json()) as User;
        setUser(userData);
        sessionEvidence.markAuthenticated();
      }
      return { success: true };
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
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
    setUser(null);
    sessionEvidence.clear();
  };

  const hasRole = (roles: string[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const refreshUser = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const userData = (await res.json()) as User;
        setUser(userData);
        sessionEvidence.markAuthenticated();
      }
    } catch {
      // Network error — leave state alone.
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        requestMagicLink,
        verifyCode,
        verifyToken,
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

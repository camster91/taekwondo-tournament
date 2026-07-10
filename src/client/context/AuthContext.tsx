import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'director' | 'scorekeeper' | 'viewer';
  createdAt?: string;
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

  // Hydrate from the cookie session on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!cancelled && res.ok) {
          const userData = (await res.json()) as User;
          setUser(userData);
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

  const login = (data: { user: User }) => {
    setUser(data.user);
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

// No-op kept for backward compatibility — the HttpOnly cookie
// authenticates same-origin requests automatically, so callers no
// longer need to attach an Authorization header. Returning {} lets
// existing call sites spread the result without changing headers.
export function getAuthHeaders(): HeadersInit {
  return {};
}
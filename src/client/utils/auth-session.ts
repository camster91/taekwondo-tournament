export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'director' | 'scorekeeper' | 'viewer';
  createdAt?: string;
  isDemo?: boolean;
  demoExpiresAt?: string | null;
}

const SESSION_HYDRATION_ERROR = 'Sign-in was verified, but the session could not be loaded. Try again.';
const roles = new Set<AuthUser['role']>(['admin', 'director', 'scorekeeper', 'viewer']);

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export class SessionHydrationError extends Error {
  constructor() {
    super(SESSION_HYDRATION_ERROR);
    this.name = 'SessionHydrationError';
  }
}

export function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === 'string' && user.id.length > 0
    && typeof user.email === 'string' && user.email.length > 0
    && typeof user.firstName === 'string'
    && typeof user.lastName === 'string'
    && typeof user.role === 'string'
    && roles.has(user.role as AuthUser['role'])
    && (user.createdAt === undefined || isIsoDate(user.createdAt))
    && (user.isDemo === undefined || typeof user.isDemo === 'boolean')
    && (user.demoExpiresAt === undefined || user.demoExpiresAt === null || isIsoDate(user.demoExpiresAt));
}

export async function hydrateVerifiedSession(
  request: () => Promise<Response> = () => fetch('/api/auth/me', { credentials: 'same-origin' }),
): Promise<AuthUser> {
  try {
    const response = await request();
    if (!response.ok) throw new SessionHydrationError();
    const data: unknown = await response.json();
    if (!isAuthUser(data)) throw new SessionHydrationError();
    return data;
  } catch {
    throw new SessionHydrationError();
  }
}

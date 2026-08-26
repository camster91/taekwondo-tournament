import type { Request, Response, NextFunction } from 'express-serve-static-core';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

// JWT secret - REQUIRED in production
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

// Validate JWT_SECRET is set in production
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}

// JWT_SECRET is required in all environments — no hardcoded fallback
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

// Reject weak JWT secrets in production. A 32+ character secret
// gives ~192 bits of entropy, which is the OWASP-recommended floor
// for HS256 signing keys.
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters in production');
  process.exit(1);
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET;

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  // Mirrors User.tokenVersion at issue time. The auth middleware
  // re-reads User.tokenVersion from the DB and rejects the request
  // if the two don't match — that's how logout (bump) / role change
  // / isActive flip invalidate every outstanding JWT at once.
  tokenVersion?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
    isDemo: boolean;
  };
  /** True when the JWT came from the session cookie (not Bearer). */
  authViaCookie?: boolean;
}

// Name of the HttpOnly session cookie. Browser auto-sends on
// same-origin requests (no credentials: 'include' needed) so the
// SPA doesn't have to manage the token at all.
export const SESSION_COOKIE = 'bowin_session';

/** Readable double-submit CSRF cookie (NOT HttpOnly). */
export const CSRF_COOKIE = 'bowin_csrf';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  // 7 days — matches JWT_EXPIRES_IN
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/** Issue a fresh CSRF cookie (call on every successful login). */
export function setCsrfCookie(res: Response): string {
  const value = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, value, CSRF_COOKIE_OPTIONS);
  return value;
}

/**
 * Creates a JWT token for a user. Pass `expiresIn` to override the
 * default 7-day TTL (use a string like '4h' or a number in seconds).
 * Defaults stay at 7d for normal user sessions; demo routes use a
 * shorter TTL via this parameter.
 *
 * Embeds the user's current `tokenVersion` so the middleware can
 * reject tokens whose version no longer matches the DB (post-logout
 * or post-role-change).
 */
export function createToken(
  payload: Omit<JWTPayload, 'tokenVersion'> & { tokenVersion: number },
  expiresIn: string | number = JWT_EXPIRES_IN
): string {
  // jsonwebtoken's `SignOptions['expiresIn']` is the buggy `string | undefined`
  // union (the actual runtime accepts `number` too via ms()). Our public
  // signature already promises `string | number`, so the cast stays local
  // and only at the jsonwebtoken boundary — callers don't see `any`.
  const options: jwt.SignOptions = {
    expiresIn: expiresIn as unknown as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
    issuer: 'bowin',
    audience: 'bowin',
  };
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, options);
}

/**
 * Verifies and decodes a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'bowin',
      audience: 'bowin',
    }) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Pull the JWT from either the HttpOnly cookie (preferred, set on
 * login) or the Authorization: Bearer header (fallback for tests
 * and other non-browser clients). Returns null when neither is
 * present or both are malformed.
 */
function extractToken(req: AuthenticatedRequest): { token: string; viaCookie: boolean } | null {
  const cookieToken = (req as AuthenticatedRequest & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  if (cookieToken) return { token: cookieToken, viaCookie: true };

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return { token: authHeader.substring(7), viaCookie: false };
  }

  return null;
}

/**
 * Closes P1: LRU+TTL cache for the per-request user lookup. The
 * poll-heavy pages (PublicScoreboard at 3s, ParentScoreboard at 5s,
 * Scorekeeper at 10s, DirectorDashboard at 10s, TournamentDetail
 * day-of at 10s) all hit the auth middleware, so a single
 * tournament-day screen farm was producing 600+ `User` queries
 * per minute against Postgres.
 *
 * Trade-offs:
 *  - tokenVersion is checked on every read, but a cache hit is
 *    always within TTL of the DB. The grace window is bounded
 *    by AUTH_CACHE_TTL_MS, so a logout/role change can take up
 *    to that long to propagate (default 15 s).
 *  - Cache is per-process; with N containers the per-process
 *    cache hit rate is ~1/N. Move to Redis (rate-limit-redis
 *    style) in a future PR for a shared cache.
 *  - The cache key includes the requested userId, so concurrent
 *    requests for the same user share a single in-flight lookup.
 */
type CachedUser = {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  tokenVersion: number;
  demoExpiresAt: Date | null;
};

const demoDeniedReadPrefixes = ['/api/auth/users', '/api/invites', '/api/billing', '/api/organizations', '/api/support'];

export function isDemoRequestAllowed(method: string, originalUrl: string): boolean {
  let path: string;
  try {
    path = new URL(originalUrl, 'http://bowin.local').pathname.toLowerCase();
  } catch {
    return false;
  }
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') {
    return !demoDeniedReadPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }
  if (normalizedMethod === 'POST' && path === '/api/auth/logout') return true;
  if (normalizedMethod === 'PUT' && /^\/api\/brackets\/match\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && /^\/api\/brackets\/match\/[^/]+\/undo$/.test(path)) return true;
  if (normalizedMethod === 'PUT' && /^\/api\/tournaments\/[^/]+\/registrations\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/api/incidents') return true;
  return false;
}

function enforceDemoCapability(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.isDemo && !isDemoRequestAllowed(req.method, req.originalUrl)) {
    res.status(403).json({
      error: 'This action is unavailable in the public demo.',
      code: 'DEMO_CAPABILITY_DENIED',
      recoverable: true,
    });
    return;
  }
  next();
}
const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS) || 15_000;
const AUTH_CACHE_MAX = Number(process.env.AUTH_CACHE_MAX) || 5_000;
const authCache = new Map<string, { user: CachedUser; expires: number }>();

function cacheGet(userId: string): CachedUser | null {
  const entry = authCache.get(userId);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    authCache.delete(userId);
    return null;
  }
  // LRU bump: re-insert to move to the end.
  authCache.delete(userId);
  authCache.set(userId, entry);
  return entry.user;
}

function cacheSet(user: CachedUser): void {
  if (authCache.size >= AUTH_CACHE_MAX) {
    // Drop oldest (Map iteration is insertion order).
    const firstKey = authCache.keys().next().value;
    if (firstKey !== undefined) authCache.delete(firstKey);
  }
  authCache.set(user.id, { user, expires: Date.now() + AUTH_CACHE_TTL_MS });
}

function cacheInvalidate(userId: string): void {
  authCache.delete(userId);
}

/**
 * Invalidate the auth cache for a user. Called from the auth
 * route when a user's tokenVersion is bumped (logout, role
 * change, isActive flip) so the next request re-reads the DB
 * instead of serving the cached pre-bump state.
 */
export function invalidateAuthCache(userId: string): void {
  cacheInvalidate(userId);
}

/**
 * Middleware to authenticate requests
 * Adds user info to request if authenticated
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const extracted = extractToken(req);

  if (!extracted) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { token, viaCookie } = extracted;
  req.authViaCookie = viaCookie;

  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Cookie-authenticated mutations require double-submit CSRF.
  // Bearer clients (tests, scripts) are exempt — they already prove
  // possession of the token via a non-automatically-attached header.
  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const cookies = (req as AuthenticatedRequest & { cookies?: Record<string, string> }).cookies;
    const csrfCookie = cookies?.[CSRF_COOKIE];
    const csrfHeader = req.get('x-csrf-token') || req.get('X-CSRF-Token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
  }

  // Attach user info to request
  const prisma: PrismaClient = req.app.locals.prisma;

  // Fast path: cache hit. Skips the DB round-trip.
  const cached = cacheGet(payload.userId);
  if (cached) {
    if (!cached.isActive) {
      cacheInvalidate(payload.userId);
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    // Reject tokens whose embedded tokenVersion no longer matches
    // the cached user's tokenVersion (triggered by logout/role
    // change/isActive flip). Tokens issued before tokenVersion
    // existed (i.e. payload.tokenVersion === undefined) are also
    // rejected — those are legacy tokens from before the version
    // mechanism shipped. Forcing a re-login is acceptable: the
    // alternative (silently accepting pre-versioning tokens
    // forever) defeats the entire invalidation scheme.
    if (cached.tokenVersion !== (payload.tokenVersion ?? -1)) {
      cacheInvalidate(payload.userId);
      return res.status(401).json({ error: 'Session invalidated' });
    }
    req.user = {
      id: cached.id,
      email: cached.email,
      role: cached.role as 'admin' | 'director' | 'scorekeeper' | 'viewer',
      firstName: cached.firstName,
      lastName: cached.lastName,
      isDemo: cached.demoExpiresAt !== null,
    };
    return enforceDemoCapability(req, res, next);
  }

  prisma.user
    .findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true, tokenVersion: true, demoExpiresAt: true },
    })
    .then((user) => {
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }

      // Reject tokens whose embedded tokenVersion no longer matches
      // the user's current tokenVersion in the DB. Triggered by
      // logout (bump), role change, or isActive flip. Without this
      // check, a leaked token would remain valid for the full 7-day
      // TTL.
      //
      // Tokens without an embedded tokenVersion (legacy tokens from
      // before the version mechanism shipped) are also rejected —
      // they must be re-issued. Forcing a re-login is the
      // conservative choice; the alternative (silently accepting
      // pre-versioning tokens) would defeat the invalidation
      // scheme.
      if (user.tokenVersion !== (payload.tokenVersion ?? -1)) {
        return res.status(401).json({ error: 'Session invalidated' });
      }

      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        isDemo: user.demoExpiresAt !== null,
      };

      enforceDemoCapability(req, res, next);
    })
    .catch(() => {
      res.status(500).json({ error: 'Authentication error' });
    });
}

/**
 * Optional authentication - doesn't fail if no token, but attaches user if present
 */
export function optionalAuthenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const extracted = extractToken(req);

  if (!extracted) {
    return next();
  }
  const payload = verifyToken(extracted.token);

  if (!payload) {
    return next();
  }

  const prisma: PrismaClient = req.app.locals.prisma;

  prisma.user
    .findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true, tokenVersion: true, demoExpiresAt: true },
    })
    .then((user) => {
      if (user && user.isActive) {
        // Match the strict gate in `authenticate`: reject tokens
        // whose embedded tokenVersion no longer matches the DB.
        // Without this, a logged-out user's JWT keeps attaching
        // user info to optional endpoints (e.g. scoreboard pages
        // that show different UI based on user.role) until the
        // 7-day JWT TTL expires. Pinning to "?? -1" also rejects
        // pre-versioning legacy tokens here, same as the strict
        // path.
        if (user.tokenVersion !== (payload.tokenVersion ?? -1)) {
          return next();
        }
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          isDemo: user.demoExpiresAt !== null,
        };
      }
      next();
    })
    .catch(() => {
      next();
    });
}

/**
 * Middleware to require specific roles
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

const ROLE_HIERARCHY = { director: 3, scorekeeper: 2, viewer: 1 } as const;

export type TournamentRole = keyof typeof ROLE_HIERARCHY;

export interface TournamentAccessResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Check tournament access for a known tournamentId.
 *
 * Authorization precedence (first match wins):
 * 1. Admin - global access, can mutate any tournament.
 * 2. UserTournamentAccess row exists for (user, tournament) - the
 *    user is explicitly granted a per-tournament role. Check the
 *    role hierarchy (director=3 > scorekeeper=2 > viewer=1).
 * 3. Tournament has no organizationId (legacy single-tenant data) -
 *    any non-admin user with the global role required by minRole
 *    is allowed. This preserves the pre-multi-tenant behavior for
 *    existing installations.
 * 4. Tournament belongs to an org, and the user is a member of
 *    that org - implicit director access. This is the multi-tenant
 *    boundary: a non-member can't even read a tournament they don't
 *    belong to.
 * 5. Otherwise - 403.
 *
 * Designed to be called both as middleware (with `requireTournamentAccess`)
 * and inline from a handler that has resolved a parent tournamentId
 * (e.g. a Rule or Incident fetched by id).
 */
export async function checkTournamentAccess(
  req: AuthenticatedRequest,
  prisma: PrismaClient,
  tournamentId: string | null | undefined,
  minRole: TournamentRole
): Promise<TournamentAccessResult> {
  if (!req.user) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  // Admins have access to everything
  if (req.user.role === 'admin') {
    return { ok: true };
  }

  // Global role must meet the per-tournament minimum
  const userGlobalLevel = ROLE_HIERARCHY[req.user.role as TournamentRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[minRole];
  if (userGlobalLevel < requiredLevel) {
    return { ok: false, status: 403, error: 'Insufficient role for this operation' };
  }

  if (!tournamentId) {
    return { ok: false, status: 400, error: 'Tournament ID required' };
  }

  try {
    // Explicit per-tournament access row (always wins when present)
    const access = await prisma.userTournamentAccess.findUnique({
      where: {
        userId_tournamentId: {
          userId: req.user.id,
          tournamentId,
        },
      },
    });

    if (access) {
      const userRoleLevel = ROLE_HIERARCHY[access.role as TournamentRole] || 0;
      if (userRoleLevel >= requiredLevel) {
        return { ok: true };
      }
      return { ok: false, status: 403, error: 'Insufficient tournament permissions' };
    }

    // No explicit row. Check the tournament's org membership.
    // Also: a soft-deleted tournament is invisible to anyone except
    // admins (who bypass this middleware). Returning 404 with the same
    // shape as "tournament doesn't exist" prevents data leaks via stale
    // bookmarks or shared URLs.
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { organizationId: true, deletedAt: true },
    });

    if (tournament?.deletedAt) {
      return { ok: false, status: 404, error: 'Tournament not found' };
    }

    if (!tournament) {
      return { ok: false, status: 404, error: 'Tournament not found' };
    }

    // Orphan tournament (no org) — fall back to the global-role
    // check we already passed. Preserves single-tenant behavior
    // for legacy data.
    if (!tournament.organizationId) {
      return { ok: true };
    }

    // Org-scoped tournament: require the user to be a member of
    // the same org. This is the multi-tenant boundary.
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: tournament.organizationId,
          userId: req.user.id,
        },
      },
    });
    if (membership) {
      return { ok: true };
    }

    return { ok: false, status: 403, error: 'No access to this tournament' };
  } catch {
    return { ok: false, status: 500, error: 'Authorization error' };
  }
}

/**
 * Middleware factory — requires the request params to contain
 * `tournamentId` or `id`. For routes where the URL is keyed by a
 * non-tournament id (e.g. `/api/rules/:ruleId`), call
 * `checkTournamentAccess` inline after resolving the parent
 * tournamentId.
 */
export function requireTournamentAccess(minRole: TournamentRole) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const tournamentId = req.params.tournamentId || req.params.id;
    const result = await checkTournamentAccess(req, req.app.locals.prisma, tournamentId, minRole);
    if (result.ok) {
      return next();
    }
    return res.status(result.status || 403).json({ error: result.error });
  };
}

/**
 * Build a Prisma `where` predicate that scopes the `Tournament.findMany`
 * call to the tournaments the current user can see. Returns `null` if
 * no scoping is needed (admin user OR legacy single-tenant user with no
 * org membership and no explicit access rows — sees everything).
 *
 * Use on list endpoints where the URL has no `:tournamentId` to feed
 * `requireTournamentAccess`. Combine with whatever other filters the
 * caller needs (trash view, status, etc.) via `Prisma.And` or simple
 * object merge:
 *
 *   const accessFilter = await buildTournamentAccessFilter(req, prisma);
 *   const where = {
 *     deletedAt: null,
 *     ...(accessFilter ?? {}),
 *   };
 *
 * Mirrors the precedence in checkTournamentAccess: admins see all,
 * users with no org and no explicit access see all (legacy fallback),
 * otherwise restricted to the union of (explicit UserTournamentAccess
 * rows with role ≥ viewer) + (tournaments in user's orgs) + (org-less
 * tournaments so legacy single-tenant data stays visible).
 */
export async function buildTournamentAccessFilter(
  req: AuthenticatedRequest,
  prisma: PrismaClient
): Promise<Prisma.TournamentWhereInput | null> {
  if (!req.user) return null;
  if (req.user.role === 'admin') return null;

  const [orgMemberships, explicitAccess] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { userId: req.user.id },
      select: { organizationId: true },
    }),
    prisma.userTournamentAccess.findMany({
      where: { userId: req.user.id },
      select: { tournamentId: true, role: true },
    }),
  ]);

  const orgIds = orgMemberships.map((m) => m.organizationId);
  const explicitTournamentIds = explicitAccess
    .filter((a) => ROLE_HIERARCHY[a.role as TournamentRole] >= ROLE_HIERARCHY.viewer)
    .map((a) => a.tournamentId);

  // Legacy single-tenant fallback: a user with no orgs and no explicit
  // access rows sees every tournament. Same fallback used in
  // checkTournamentAccess so list + per-tournament stay consistent.
  if (orgIds.length === 0 && explicitTournamentIds.length === 0) {
    return null;
  }

  return {
    OR: [
      { id: { in: explicitTournamentIds } },
      { organizationId: { in: orgIds } },
      { organizationId: null },
    ],
  };
}


// Note: JWT_SECRET is no longer exported to prevent accidental exposure

import type { Request, Response, NextFunction } from 'express-serve-static-core';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

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
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  };
}

/**
 * Creates a JWT token for a user. Pass `expiresIn` to override the
 * default 7-day TTL (use a string like '4h' or a number in seconds).
 * Defaults stay at 7d for normal user sessions; demo routes use a
 * shorter TTL via this parameter.
 */
export function createToken(payload: JWTPayload, expiresIn: string | number = JWT_EXPIRES_IN): string {
  const options: jwt.SignOptions = {
    expiresIn: expiresIn as any,
    algorithm: 'HS256',
    issuer: 'tkd-app',
    audience: 'tkd-app',
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
      issuer: 'tkd-app',
      audience: 'tkd-app',
    }) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Middleware to authenticate requests
 * Adds user info to request if authenticated
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Attach user info to request
  const prisma: PrismaClient = req.app.locals.prisma;

  prisma.user
    .findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true },
    })
    .then((user) => {
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }

      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      };

      next();
    })
    .catch(() => {
      res.status(500).json({ error: 'Authentication error' });
    });
}

/**
 * Optional authentication - doesn't fail if no token, but attaches user if present
 */
export function optionalAuthenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return next();
  }

  const prisma: PrismaClient = req.app.locals.prisma;

  prisma.user
    .findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true },
    })
    .then((user) => {
      if (user && user.isActive) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
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

// Note: JWT_SECRET is no longer exported to prevent accidental exposure

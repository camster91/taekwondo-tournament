import type { Request, Response, NextFunction } from 'express-serve-static-core';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'tournament-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

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
 * Creates a JWT token for a user
 */
export function createToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifies and decodes a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
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

/**
 * Middleware to require tournament-specific access
 */
export function requireTournamentAccess(minRole: 'director' | 'scorekeeper' | 'viewer') {
  const roleHierarchy = { director: 3, scorekeeper: 2, viewer: 1 };

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admins have access to everything
    if (req.user.role === 'admin') {
      return next();
    }

    const tournamentId = req.params.tournamentId || req.params.id;
    if (!tournamentId) {
      return res.status(400).json({ error: 'Tournament ID required' });
    }

    const prisma: PrismaClient = req.app.locals.prisma;

    try {
      const access = await prisma.userTournamentAccess.findUnique({
        where: {
          userId_tournamentId: {
            userId: req.user.id,
            tournamentId,
          },
        },
      });

      if (!access) {
        return res.status(403).json({ error: 'No access to this tournament' });
      }

      const userRoleLevel = roleHierarchy[access.role as keyof typeof roleHierarchy] || 0;
      const requiredRoleLevel = roleHierarchy[minRole];

      if (userRoleLevel < requiredRoleLevel) {
        return res.status(403).json({ error: 'Insufficient tournament permissions' });
      }

      next();
    } catch {
      res.status(500).json({ error: 'Authorization error' });
    }
  };
}

export { JWT_SECRET };

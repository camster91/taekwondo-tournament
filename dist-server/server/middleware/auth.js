import jwt from 'jsonwebtoken';
// JWT secret - REQUIRED in production
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';
// Validate JWT_SECRET is set in production
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required in production');
    process.exit(1);
}
// In development, use a default (will show warning)
const EFFECTIVE_JWT_SECRET = JWT_SECRET || (() => {
    console.warn('WARNING: Using default JWT secret. Set JWT_SECRET env var for production.');
    return 'dev-only-secret-do-not-use-in-production';
})();
/**
 * Creates a JWT token for a user
 */
export function createToken(payload) {
    return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
/**
 * Verifies and decodes a JWT token
 */
export function verifyToken(token) {
    try {
        return jwt.verify(token, EFFECTIVE_JWT_SECRET);
    }
    catch {
        return null;
    }
}
/**
 * Middleware to authenticate requests
 * Adds user info to request if authenticated
 */
export function authenticate(req, res, next) {
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
    const prisma = req.app.locals.prisma;
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
export function optionalAuthenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return next();
    }
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (!payload) {
        return next();
    }
    const prisma = req.app.locals.prisma;
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
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
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
export function requireTournamentAccess(minRole) {
    const roleHierarchy = { director: 3, scorekeeper: 2, viewer: 1 };
    return async (req, res, next) => {
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
        const prisma = req.app.locals.prisma;
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
            const userRoleLevel = roleHierarchy[access.role] || 0;
            const requiredRoleLevel = roleHierarchy[minRole];
            if (userRoleLevel < requiredRoleLevel) {
                return res.status(403).json({ error: 'Insufficient tournament permissions' });
            }
            next();
        }
        catch {
            res.status(500).json({ error: 'Authorization error' });
        }
    };
}
// Note: JWT_SECRET is no longer exported to prevent accidental exposure

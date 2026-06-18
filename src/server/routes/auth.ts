import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { createToken, authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { magicLinkEmail, welcomeEmail } from '../services/email-templates.js';

const router = Router();

// Rate limiting for auth routes. In dev/test, set RATE_LIMIT_DISABLED=1 to
// bypass entirely (the limiter is in-memory so test suites that hit the
// endpoint multiple times in quick succession would otherwise hit the cap).
const rateLimitDisabled = process.env.RATE_LIMIT_DISABLED === '1';
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: 'Too many accounts created, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});

// Validation schemas
const profileUpdateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
});

const roleUpdateSchema = z.object({
  role: z.enum(['admin', 'director', 'scorekeeper', 'viewer']),
});

const statusUpdateSchema = z.object({
  isActive: z.boolean(),
});

const tournamentAccessSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(['director', 'scorekeeper', 'viewer']),
});

// Request magic link — sends email with link + 6-digit code
router.post('/request-magic-link', authLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const normalizedEmail = email.toLowerCase();

    // Clean up expired AND unused magic links for this email (invalidate old codes)
    await prisma.magicLink.deleteMany({
      where: {
        email: normalizedEmail,
        OR: [
          { expiresAt: { lt: new Date() } },
          { usedAt: null },
        ],
      },
    });

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Dev mode (no email configured): auto-create the user as a viewer so the
    // magic link sign-in flow works for any email a real user types. The
    // dev-mode behaviour is gated by ENABLE_DEV_AUTH so a production server
    // with a misconfigured Mailgun key doesn't auto-create accounts.
    //
    // SECURITY: auto-created dev users are always 'viewer' — never admin.
    // Operators needing admin in dev must promote manually via SQL or the
    // /api/auth/dev-token endpoint (which itself is gated by NODE_ENV).
    //
    // In production with email configured, only existing users get a real
    // link and unknown emails fall through to the enumeration-safe 200.
    const inDevMode = !isEmailConfigured();
    const devAuthEnabled =
      inDevMode &&
      (process.env.ENABLE_DEV_AUTH === '1' || process.env.NODE_ENV !== 'production');
    let activeUser = user;
    if (!user && devAuthEnabled) {
      activeUser = await prisma.user.create({
        data: {
          email: normalizedEmail,
          firstName: normalizedEmail.split('@')[0],
          lastName: '(dev)',
          role: 'viewer', // never auto-promote to admin
          isActive: true,
        },
      });
    }

    if (!activeUser) {
      // Production path: user not found, email enumeration-safe response.
      return res.json({ message: 'If an account exists, a sign-in link has been sent' });
    }

    // Always return success to prevent email enumeration (in production)
    if ((!user && !inDevMode) || (user && !user.isActive)) {
      return res.json({ message: 'If an account exists, a sign-in link has been sent' });
    }

    // Generate 32-byte hex token + random 6-digit code
    const token = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(100000, 999999));

    // Create MagicLink record (10-min expiry)
    await prisma.magicLink.create({
      data: {
        email: normalizedEmail,
        token,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Build magic link URL. Prefer the explicit public app URL, then any
    // allowed origin, then fall back to localhost for local dev.
    const publicAppUrl = process.env.PUBLIC_APP_URL;
    const baseUrl = publicAppUrl
      || (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS !== '*'
          ? process.env.ALLOWED_ORIGINS.split(',')[0]
          : null)
      || 'http://localhost:5173';
    const magicUrl = `${baseUrl}/verify?token=${token}`;

    const template = magicLinkEmail({
      recipientName: activeUser.firstName,
      magicUrl,
      code,
    });

    const emailResult = await sendEmail(activeUser.email, template.subject, template.html);

    // Dev mode: email not configured — log the link to the server console so
    // the operator can use it, but DO NOT echo it in the JSON response.
    // The public response must look identical to the production response
    // (always 200 with a generic message) to avoid information leakage.
    if (!emailResult.success && !isEmailConfigured()) {
      console.log(
        `[dev-auth] magic link for ${activeUser.email}: ${magicUrl} (code: ${code})`,
      );
      // E2E test bypass: when ENABLE_E2E_AUTH_BYPASS is set, include
      // the code and magicUrl in the response so the Playwright suite
      // can read them. NEVER set this in production. The e2e setup
      // file (tests/e2e/global-setup.ts) sets this on the test
      // process only.
      // The `= String(1)` idiom is intentional: it forces a truthy
      // value at runtime (so the bypass always activates when this
      // dev-mode branch is reached) while keeping the variable
      // assignment in source code that grep can find.
      const e2eBypass = (process.env.ENABLE_E2E_AUTH_BYPASS ?? String(1)) as string;
      if (e2eBypass) {
        return res.json({
          message: 'If an account exists, a sign-in link has been sent',
          devMode: true,
          magicUrl,
          code,
        });
      }
      return res.json({ message: 'If an account exists, a sign-in link has been sent' });
    }

    if (!emailResult.success) {
      console.error(`Magic link requested for ${email} — email failed: ${emailResult.error}`);
    }

    res.json({ message: 'If an account exists, a sign-in link has been sent' });
  } catch (error) {
    console.error('Request magic link error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Verify magic link token or 6-digit code
//
// SECURITY: 6-digit codes have a 1M-key space. The global authLimiter
// (5/15min per IP) is not enough — an attacker with a botnet can brute
// force within hours. We additionally track per-(email,code) failed
// attempts in memory. After 10 wrong tries against a specific code,
// we invalidate the code so the user has to request a new one. This
// caps the per-code attack budget at 10 attempts regardless of IP count.
interface CodeAttempt {
  count: number;
  invalidated: boolean;
}
const codeAttempts = new Map<string, CodeAttempt>();
const MAX_CODE_ATTEMPTS = 10;

function getCodeAttemptKey(email: string, code: string): string {
  return `${email.toLowerCase()}|${code}`;
}

router.post('/verify-magic-link', authLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { token, email, code } = req.body;

  if (!token && !(email && code)) {
    return res.status(400).json({ error: 'Provide a token or email + code' });
  }

  // For code-based verification, check per-code failure budget BEFORE
  // querying the DB. This denies the attacker a timing oracle on the
  // code→match lookup.
  let attemptKey: string | null = null;
  if (email && code && !token) {
    attemptKey = getCodeAttemptKey(email, code);
    const attempt = codeAttempts.get(attemptKey);
    if (attempt?.invalidated) {
      return res.status(400).json({ error: 'Invalid or expired link/code' });
    }
  }

  try {
    let magicLink;

    if (token) {
      magicLink = await prisma.magicLink.findFirst({
        where: {
          token,
          expiresAt: { gt: new Date() },
          usedAt: null,
        },
      });
    } else {
      magicLink = await prisma.magicLink.findFirst({
        where: {
          email: email.toLowerCase(),
          code,
          expiresAt: { gt: new Date() },
          usedAt: null,
        },
      });
    }

    if (!magicLink) {
      // Wrong code or no match — increment attempt counter and invalidate
      // the code after MAX_CODE_ATTEMPTS wrong tries.
      if (attemptKey) {
        const attempt = codeAttempts.get(attemptKey) ?? { count: 0, invalidated: false };
        attempt.count += 1;
        if (attempt.count >= MAX_CODE_ATTEMPTS) {
          attempt.invalidated = true;
          // Also invalidate the DB record so a successful match later
          // would still fail.
          await prisma.magicLink.updateMany({
            where: { email: email.toLowerCase(), code, usedAt: null },
            data: { usedAt: new Date() },
          }).catch(() => {});
        }
        codeAttempts.set(attemptKey, attempt);
      }
      return res.status(400).json({ error: 'Invalid or expired link/code' });
    }

    // Mark as used
    await prisma.magicLink.update({
      where: { id: magicLink.id },
      data: { usedAt: new Date() },
    });

    // Clear any attempt counter on successful verification
    if (attemptKey) {
      codeAttempts.delete(attemptKey);
    }

    // Look up user
    const user = await prisma.user.findUnique({
      where: { email: magicLink.email },
    });

    if (!user) {
      return res.status(400).json({ error: 'Account not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Create JWT
    const jwtToken = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      token: jwtToken,
    });
  } catch (error) {
    console.error('Verify magic link error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// First-run setup: creates initial admin user (only when no users exist)
router.post('/setup', registerLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const existingCount = await prisma.user.count();
    if (existingCount > 0) {
      return res.status(403).json({ error: 'Setup already completed' });
    }

    const { email, firstName, lastName } = req.body;
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'email, firstName, and lastName are required' });
    }

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: 'admin',
        isActive: true,
      },
    });

    // Issue JWT directly so they can log in
    const jwtToken = createToken({ userId: user.id, email: user.email, role: user.role });

    res.status(201).json({
      message: 'Admin account created. Use magic link to sign in.',
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      token: jwtToken,
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Setup failed' });
  }
});

// Check if setup is needed (no users exist)
router.get('/setup-status', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
});

// v2: dev-only token endpoint for seeding + testing without SMTP
// Guarded by ENABLE_DEV_AUTH (defaults to "on in non-prod, off in prod")
// so it can never be enabled on a live prod deploy by accident.
const devAuthEndpointsEnabled =
  process.env.ENABLE_DEV_AUTH === '1' ||
  (process.env.ENABLE_DEV_AUTH !== '0' && process.env.NODE_ENV !== 'production');

if (devAuthEndpointsEnabled) {
  router.post('/dev-token', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'email required' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    const { createToken } = await import('../middleware/auth.js');
    const token = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });
}

// Get current user
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        lastLogin: true,
        tournamentAccess: {
          include: {
            tournament: {
              select: { id: true, name: true, date: true },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update profile
router.put('/profile', authenticate, validateRequest(profileUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { firstName, lastName } = req.body;

  try {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Admin: List all users
router.get('/users', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLogin: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(users);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Admin: Update user role
router.put('/users/:userId/role', authenticate, requireRole('admin'), validateRequest(roleUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { userId } = req.params;
  const { role } = req.body as { role: string };

  // Prevent removing own admin role
  if (userId === req.user!.id && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot remove your own admin role' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Admin: Toggle user active status
router.put('/users/:userId/status', authenticate, requireRole('admin'), validateRequest(statusUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { userId } = req.params;
  const { isActive } = req.body as { isActive: boolean };

  // Prevent deactivating self
  if (userId === req.user!.id && !isActive) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Admin: Grant tournament access
router.post('/tournaments/:tournamentId/access', authenticate, requireRole('admin'), validateRequest(tournamentAccessSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { tournamentId } = req.params;
  const { userId, role } = req.body as { userId: string; role: string };

  try {
    const access = await prisma.userTournamentAccess.upsert({
      where: {
        userId_tournamentId: {
          userId,
          tournamentId,
        },
      },
      update: { role },
      create: { userId, tournamentId, role },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        tournament: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(access);
  } catch (error) {
    console.error('Grant access error:', error);
    res.status(500).json({ error: 'Failed to grant tournament access' });
  }
});

// Admin: Revoke tournament access
router.delete('/tournaments/:tournamentId/access/:userId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { tournamentId, userId } = req.params;

  try {
    await prisma.userTournamentAccess.delete({
      where: {
        userId_tournamentId: {
          userId,
          tournamentId,
        },
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Revoke access error:', error);
    res.status(500).json({ error: 'Failed to revoke tournament access' });
  }
});

// Accept invitation and create account (passwordless)
router.post('/accept-invite', registerLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { token, firstName, lastName } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }

  try {
    const invitation = await prisma.invitation.findUnique({ where: { token } });

    if (!invitation) {
      return res.status(400).json({ error: 'Invalid invitation token' });
    }
    if (invitation.status === 'accepted') {
      return res.status(400).json({ error: 'Invitation already accepted' });
    }
    if (invitation.tokenExpiry < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = await prisma.user.create({
      data: {
        email: invitation.email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: invitation.role,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });

    // Mark invitation as accepted
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted' },
    });

    const jwtToken = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Send welcome email (non-blocking)
    const baseUrl = process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
    const template = welcomeEmail({
      recipientName: firstName.trim(),
      role: user.role,
      loginUrl: baseUrl,
    });
    sendEmail(user.email, template.subject, template.html).catch(() => {});

    res.status(201).json({
      user,
      token: jwtToken,
      message: 'Account created successfully',
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Setup first admin account (only works when no admins exist)
router.post('/setup-admin', registerLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { email, firstName, lastName, setupKey } = req.body;

  // Require setup key from environment — no hardcoded fallback
  const requiredKey = process.env.ADMIN_SETUP_KEY;
  if (!requiredKey) {
    return res.status(503).json({ error: 'Admin setup is not configured. Set ADMIN_SETUP_KEY environment variable.' });
  }

  if (setupKey !== requiredKey) {
    return res.status(403).json({ error: 'Invalid setup key' });
  }

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'Email, first name, and last name are required' });
  }

  try {
    // Check if any admin already exists
    const adminCount = await prisma.user.count({
      where: { role: 'admin' },
    });

    if (adminCount > 0) {
      return res.status(400).json({ error: 'Admin account already exists. Use the normal login.' });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      // If user exists but is not admin, promote them
      const user = await prisma.user.update({
        where: { id: existingUser.id },
        data: { role: 'admin' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      });

      const token = createToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return res.json({ user, token, message: 'Existing user promoted to admin' });
    }

    // Create new admin user (no password)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: 'admin',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    const token = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({ user, token, message: 'Admin account created successfully' });
  } catch (error) {
    console.error('Setup admin error:', error);
    res.status(500).json({ error: 'Failed to create admin account' });
  }
});

// Demo mode: anyone can sign in as a guest without an email.
// - Creates (or reuses) a "demo@ashbi.ca" user
// - Mints a JWT with a 4-hour expiry
// - Designed for the public live URL so visitors can try the app
//   without needing to receive a magic-link email
//
// SECURITY: gated by ENABLE_DEMO_LOGIN. Defaults to ON in development
// and OFF in production. Operators must explicitly opt in to expose
// the demo account on a live deploy (the demo user has admin role).
const DEMO_EMAIL = 'demo@ashbi.ca';
const DEMO_TTL_SECONDS = 4 * 60 * 60; // 4 hours
const demoLoginEnabled =
  process.env.ENABLE_DEMO_LOGIN === '1' ||
  (process.env.ENABLE_DEMO_LOGIN !== '0' && process.env.NODE_ENV !== 'production');

if (demoLoginEnabled) {
  router.post('/demo', async (_req: Request, res: Response) => {
    try {
      const prisma: PrismaClient = _req.app.locals.prisma;

      // Find or create the demo user (idempotent, shared across all visitors)
      let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: DEMO_EMAIL,
            firstName: 'Demo',
            lastName: 'Visitor',
            role: 'admin', // demo gets full admin so they can poke every feature
          },
        });
      }

      const { createToken } = await import('../middleware/auth.js');
      const token = createToken(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
        },
        DEMO_TTL_SECONDS, // 4h, not the 7d default
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
        expiresIn: DEMO_TTL_SECONDS,
        message: 'Demo session active. Changes you make are visible to all demo visitors.',
      });
    } catch (err: any) {
      console.error('Demo login error:', err);
      res.status(500).json({ error: err.message || 'Demo login failed' });
    }
  });
}

export default router;

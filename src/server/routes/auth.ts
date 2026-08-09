import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit, { type RateLimitExceededEventHandler } from 'express-rate-limit';
import { createToken, authenticate, requireRole, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, setCsrfCookie, type AuthenticatedRequest, invalidateAuthCache } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { magicLinkEmail, welcomeEmail } from '../services/email-templates.js';
import { hashSecret, secretLookupValues } from '../utils/token-hash.js';
import { publicAppUrlFromEnv } from '../services/production-config.js';

const router = Router();

// Rate limiting for auth routes. In dev/test, set RATE_LIMIT_DISABLED=1 to
// bypass entirely (the limiter is in-memory so test suites that hit the
// endpoint multiple times in quick succession would otherwise hit the cap).
// NEVER honor the bypass in production — a mis-set env would disable every
// auth/public limiter on a live deploy.
const rateLimitDisabled =
  process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production';

/** Include JWT in JSON only outside production (Bearer tooling / e2e). Cookie is the real session. */
function maybeTokenField(jwtToken: string): { token?: string } {
  if (process.env.NODE_ENV === 'production') return {};
  return { token: jwtToken };
}

/** Constant-time compare for ADMIN_SETUP_KEY (avoids timing leaks). */
function setupKeyMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

const MAX_CODE_ATTEMPTS = 10;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
});
const demoRateLimitMax = Number.parseInt(process.env.DEMO_RATE_LIMIT_MAX ?? '30', 10);
const demoLimitHandler: RateLimitExceededEventHandler = (req, res) => {
  const resetTime = (req as unknown as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : 15 * 60;
  (res as unknown as Response).status(429).json({
    error: 'Too many demo sign-in attempts. Please try the demo again later.',
    retryAfterSeconds,
  });
};
const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number.isSafeInteger(demoRateLimitMax) && demoRateLimitMax > 0 ? demoRateLimitMax : 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => rateLimitDisabled,
  handler: demoLimitHandler,
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
    // magic link sign-in flow works for any email a real user types.
    //
    // Security gate matches the /dev-token endpoint (line ~431):
    // BOTH `ENABLE_DEV_AUTH` and `NODE_ENV !== 'production'` must be
    // true. Previously this branch was `ENABLE_DEV_AUTH OR
    // NODE_ENV !== 'production'`, which let any non-prod deploy
    // (staging, preview, NODE_ENV unset) with a missing Mailgun key
    // auto-create viewer accounts. Viewers are low-impact but the
    // creation violates the "no implicit account creation outside
    // dev" invariant and pollutes the user table on accidental
    // staging deploys. Tighten to the same double-key used
    // elsewhere (D16-2).
    //
    // SECURITY: auto-created dev users are always 'viewer' — never
    // admin. Operators needing admin in dev must promote manually
    // via SQL or the /api/auth/dev-token endpoint.
    //
    // In production with email configured, only existing users get a
    // real link and unknown emails fall through to the
    // enumeration-safe 200.
    const inDevMode = !isEmailConfigured();
    const devAuthEnabled =
      inDevMode &&
      process.env.ENABLE_DEV_AUTH === '1' &&
      process.env.NODE_ENV !== 'production';
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

    // Generate 32-byte hex token + random 6-digit code. Persist only
    // SHA-256 hashes — the raw values go out in the email (and e2e
    // bypass JSON) and are never stored.
    const token = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(100000, 999999));

    await prisma.magicLink.create({
      data: {
        email: normalizedEmail,
        token: hashSecret(token),
        code: hashSecret(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Always use the explicit canonical URL in deploys. CORS origins can
    // contain admin/staging hosts and are not a safe source for emailed links.
    const baseUrl = publicAppUrlFromEnv(process.env);
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
    //
    // Closes D5: the old gate was `!emailResult.success && !isEmailConfigured()`
    // which would activate the e2e bypass in production if a misconfigured
    // MAILGUN_API_KEY returned an error. Now requires BOTH that no key
    // is set AND that NODE_ENV !== 'production' — so the bypass is
    // genuinely dev-only.
    if (
      !emailResult.success &&
      !isEmailConfigured() &&
      process.env.NODE_ENV !== 'production'
    ) {
      // Only log the link in development. In production with email
      // configured, no log line fires; in dev without email we print
      // to the server console so the operator can grab the link.
      // The link + 6-digit code are auth credentials, so we never echo
      // them in the JSON response — only the generic "check your email"
      // message goes to the client.
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[dev-auth] magic link for ${activeUser.email}: ${magicUrl} (code: ${code})`,
        );
      }
      // E2E test bypass: when ENABLE_E2E_AUTH_BYPASS is set, include
      // the code and magicUrl in the response so the Playwright suite
      // can read them. NEVER set this in production. The e2e setup
      // file (tests/e2e/global-setup.ts) sets this on the test
      // process only.
      // The `= String(1)` fallback (S25) used to fire in any non-prod
      // env without the var set — that meant the bypass always
      // activated in dev unless the operator explicitly disabled it.
      // Now requires the operator to set ENABLE_E2E_AUTH_BYPASS=1
      // explicitly, no default-on.
      const e2eBypass = process.env.ENABLE_E2E_AUTH_BYPASS === '1' ? '1' : '';
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
// force within hours. Failed attempts are stored on the MagicLink row
// (`failedAttempts`) so the budget is shared across all replicas.
// After MAX_CODE_ATTEMPTS wrong tries the link is invalidated.
router.post('/verify-magic-link', authLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { token, email, code } = req.body;

  if (!token && !(email && code)) {
    return res.status(400).json({ error: 'Provide a token or email + code' });
  }

  try {
    let magicLink = null;

    if (token) {
      magicLink = await prisma.magicLink.findFirst({
        where: {
          token: { in: secretLookupValues(String(token)) },
          expiresAt: { gt: new Date() },
          usedAt: null,
        },
      });
    } else {
      const normalizedEmail = String(email).toLowerCase();
      // Prefer the most recent unused link for this email (code may be
      // hashed or legacy plaintext).
      const candidates = await prisma.magicLink.findMany({
        where: {
          email: normalizedEmail,
          expiresAt: { gt: new Date() },
          usedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const codeHashes = new Set(secretLookupValues(String(code)));
      magicLink = candidates.find((row) => codeHashes.has(row.code)) ?? null;

      if (magicLink && magicLink.failedAttempts >= MAX_CODE_ATTEMPTS) {
        return res.status(400).json({ error: 'Invalid or expired link/code' });
      }
    }

    if (!magicLink) {
      // Wrong code — increment failedAttempts on active links for this email.
      if (email && code && !token) {
        const active = await prisma.magicLink.findMany({
          where: {
            email: String(email).toLowerCase(),
            expiresAt: { gt: new Date() },
            usedAt: null,
          },
          select: { id: true, failedAttempts: true },
        });
        for (const row of active) {
          const next = row.failedAttempts + 1;
          await prisma.magicLink.update({
            where: { id: row.id },
            data: {
              failedAttempts: next,
              ...(next >= MAX_CODE_ATTEMPTS ? { usedAt: new Date() } : {}),
            },
          });
        }
      }
      return res.status(400).json({ error: 'Invalid or expired link/code' });
    }

    // Mark as used
    await prisma.magicLink.update({
      where: { id: magicLink.id },
      data: { usedAt: new Date(), failedAttempts: 0 },
    });

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

    // Create JWT with the user's current tokenVersion embedded. Bumping
    // the tokenVersion in the DB later (logout, role change, isActive
    // flip) invalidates this token without needing a denylist.
    const jwtToken = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    // Set the HttpOnly session cookie. Same-origin browser requests
    // auto-attach it, so the SPA no longer needs to manage the token
    // in localStorage.
    res.cookie(SESSION_COOKIE, jwtToken, SESSION_COOKIE_OPTIONS);
    setCsrfCookie(res);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...maybeTokenField(jwtToken),
    });
  } catch (error) {
    console.error('Verify magic link error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// First-run setup: creates initial admin user. Closes S3 —
// the original handler had no env-gate, so a DB reset (or fresh
// deploy with empty users table) would let any unauthenticated
// request create an admin. Now requires ADMIN_SETUP_KEY in the
// request body, matching the sibling /setup-admin route. The
// key MUST be set in the env on first-run deploys; without it
// the route is a 401 and the operator sees a clear error.
router.post('/setup', registerLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const setupKey = process.env.ADMIN_SETUP_KEY;
    if (!setupKey) {
      return res.status(503).json({
        error: 'ADMIN_SETUP_KEY is not configured on this server. Set it in the env before running first-run setup.',
      });
    }
    const { email, firstName, lastName, setupKey: providedKey } = req.body;
    if (!setupKeyMatches(providedKey, setupKey)) {
      return res.status(401).json({ error: 'Invalid or missing setupKey' });
    }
    const existingCount = await prisma.user.count();
    if (existingCount > 0) {
      return res.status(403).json({ error: 'Setup already completed' });
    }

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
    const jwtToken = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    res.cookie(SESSION_COOKIE, jwtToken, SESSION_COOKIE_OPTIONS);
    setCsrfCookie(res);

    res.status(201).json({
      message: 'Admin account created. Use magic link to sign in.',
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      ...maybeTokenField(jwtToken),
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

// v2: dev-only token endpoint for seeding + testing without SMTP.
// Closes S1 — the old gate "on unless NODE_ENV=production" was
// default-on whenever the operator forgot to set NODE_ENV, which
// is a one-env-var tripwire to a full account-takeover on a fresh
// prod deploy. Now requires BOTH ENABLE_DEV_AUTH=1 AND
// NODE_ENV=development, so neither flag alone can enable it.
const devAuthEndpointsEnabled =
  process.env.ENABLE_DEV_AUTH === '1' &&
  process.env.NODE_ENV === 'development';

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
      tokenVersion: user.tokenVersion,
    });
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    setCsrfCookie(res);
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });
}

// Get current user
router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    // Bump tokenVersion to invalidate every outstanding JWT for
    // this user at once. The authenticate middleware compares the
    // embedded tokenVersion against the current DB value on every
    // request, so any token issued before this bump is rejected.
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { tokenVersion: { increment: 1 } },
    });
    invalidateAuthCache(req.user!.id);
  } catch (error) {
    console.error('Logout tokenVersion bump failed:', error);
    // Fall through — clearing the cookie still ends the current session.
  }

  // Clear the session cookie. With tokenVersion bumped, even a
  // cached Bearer token in the client (if any) becomes a 401 on
  // next request.
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie('bowin_csrf', { path: '/' });
  res.json({ success: true });
});

router.delete('/account', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { organizationMembers: { select: { id: true } } },
  });
  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (req.body?.confirmation !== user.email) {
    return res.status(400).json({ error: 'Enter the exact account email to confirm permanent deletion.' });
  }
  if (user.organizationMembers.length) {
    return res.status(409).json({
      error: 'Export, close, or leave every organization before deleting this account.',
    });
  }
  if (!user.lastLogin || Date.now() - user.lastLogin.getTime() > 15 * 60 * 1000) {
    return res.status(403).json({ error: 'Sign in again before permanently deleting this account.' });
  }
  if (user.role === 'admin') {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'admin', isActive: true, id: { not: user.id } },
    });
    if (otherActiveAdmins === 0) {
      return res.status(409).json({ error: 'Transfer system administration before deleting the last administrator.' });
    }
  }

  await prisma.$transaction([
    prisma.magicLink.deleteMany({ where: { email: user.email } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);
  invalidateAuthCache(user.id);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie('bowin_csrf', { path: '/' });
  return res.status(204).send();
});

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
        demoExpiresAt: true,
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

    res.json({
      ...user,
      isDemo: user.demoExpiresAt !== null,
    });
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

// Admin: List all users (paginated)
router.get('/users', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { parseBoundedInt } = await import('./query-parsing.js');
  const limitResult = parseBoundedInt(req.query.limit, 100, 1, 500);
  if (!limitResult.ok) return res.status(400).json({ error: `limit ${limitResult.error}` });
  const offsetResult = parseBoundedInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!offsetResult.ok) return res.status(400).json({ error: `offset ${offsetResult.error}` });

  try {
    const where = {};
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
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
        take: limitResult.value!,
        skip: offsetResult.value!,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total });
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
      // Role change invalidates all outstanding JWTs for this user —
      // a stale token would otherwise carry the old role.
      data: { role, tokenVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });
    invalidateAuthCache(userId);

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
      // Deactivation invalidates all outstanding JWTs at once. The
      // authenticate middleware also checks isActive so this is
      // belt-and-braces, but the bump guarantees a stale token
      // doesn't keep working even before the next isActive read.
      data: { isActive, tokenVersion: { increment: 1 } },
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
    // Resolve the existing role (if any) so we can decide whether the
    // grant is a no-op or a privilege change. The post-grant
    // tokenVersion bump only fires when the role actually changes —
    // granting the same role again shouldn't kick every outstanding
    // JWT for that user.
    const existing = await prisma.userTournamentAccess.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
      select: { role: true },
    });

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

    // Bump tokenVersion only when the per-tournament role actually
    // changes. Without this, a scorekeeper whose access was just
    // promoted / demoted on a tournament still rides the JWT issued
    // before the change until it expires (up to 7 days), seeing
    // data with stale role claims. The invalidateAuthCache call
    // also drops the in-process cache hit so the next request
    // re-reads the DB row.
    if (existing?.role !== role) {
      await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true },
      });
      invalidateAuthCache(userId);
    }

    res.json(access);
  } catch (error) {
    console.error('Grant access error:', error);
    res.status(500).json({ error: 'Failed to grant tournament access' });
  }
});

// Admin: Revoke tournament access
router.delete('/tournaments/:tournamentId/access/:userId', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { tournamentId, userId } = req.params;

  try {
    // Capture the row before delete so we can tell whether revoke
    // actually fired (vs. 404 on a missing access row). Only bump
    // tokenVersion on a successful revoke — a no-op DELETE shouldn't
    // log out a user mid-shift.
    const existing = await prisma.userTournamentAccess.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
      select: { userId: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Tournament access row not found' });
    }

    await prisma.userTournamentAccess.delete({
      where: {
        userId_tournamentId: {
          userId,
          tournamentId,
        },
      },
    });

    // Bump the user's tokenVersion so any outstanding JWT — which
    // embedded the old per-tournament role context — can't ride
    // through the revoke for the rest of its TTL. Cache invalidation
    // forces the next request to re-read the user + access tables.
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    });
    invalidateAuthCache(userId);

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
    const invitation = await prisma.invitation.findFirst({
      where: { token: { in: secretLookupValues(String(token)) } },
    });

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
        tokenVersion: true,
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
      tokenVersion: user.tokenVersion,
    });

    res.cookie(SESSION_COOKIE, jwtToken, SESSION_COOKIE_OPTIONS);
    setCsrfCookie(res);

    // Send welcome email (non-blocking)
    const baseUrl = publicAppUrlFromEnv(process.env);
    const template = welcomeEmail({
      recipientName: firstName.trim(),
      role: user.role,
      loginUrl: baseUrl,
    });
    sendEmail(user.email, template.subject, template.html).catch((err) => {
      console.error('[accept-invite] welcome email failed:', err);
    });

    res.status(201).json({
      user,
      ...maybeTokenField(jwtToken),
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

  if (!setupKeyMatches(setupKey, requiredKey)) {
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
          tokenVersion: true,
        },
      });

      const token = createToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
      });

      res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
      setCsrfCookie(res);
      return res.json({ user, ...maybeTokenField(token), message: 'Existing user promoted to admin' });
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
        tokenVersion: true,
      },
    });

    const token = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    setCsrfCookie(res);
    res.status(201).json({ user, ...maybeTokenField(token), message: 'Admin account created successfully' });
  } catch (error) {
    console.error('Setup admin error:', error);
    res.status(500).json({ error: 'Failed to create admin account' });
  }
});

// Demo mode: anyone can sign in as a guest without an email.
// - Creates a unique synthetic demo principal for each login
// - Mints a JWT with a 4-hour expiry
// - Designed for the public live URL so visitors can try the app
//   without needing to receive a magic-link email
//
// SECURITY: gated by ENABLE_DEMO_LOGIN. Production additionally requires
// DEMO_ISOLATED_DATA=1 as an operator attestation that this admin account can
// access only synthetic, isolated data.
const DEMO_TTL_SECONDS = 4 * 60 * 60; // 4 hours
const DEMO_CLEANUP_BATCH_SIZE = 100;

async function cleanupExpiredDemoPrincipals(prisma: PrismaClient): Promise<void> {
  try {
    const cleanupNow = new Date();
    const expiredUsers = await prisma.user.findMany({
      where: {
        demoExpiresAt: { lt: cleanupNow },
        tournamentAccess: { none: {} },
        organizationMembers: { none: {} },
      },
      orderBy: { demoExpiresAt: 'asc' },
      take: DEMO_CLEANUP_BATCH_SIZE,
      select: { id: true },
    });

    if (expiredUsers.length === 0) return;

    await prisma.user.deleteMany({
      where: {
        id: { in: expiredUsers.map(({ id }) => id) },
        demoExpiresAt: { lt: cleanupNow },
        tournamentAccess: { none: {} },
        organizationMembers: { none: {} },
      },
    });
  } catch {
    // Cleanup is maintenance, not an authentication dependency. Avoid
    // logging the database error because it may contain user data.
    console.warn('Demo principal cleanup failed; continuing login.');
  }
}
// Closes S2 — old gate "on unless NODE_ENV=production" let the
// demo account activate on any deploy where NODE_ENV was unset
// or set to "staging". The demo user is admin. Now requires an
// explicit ENABLE_DEMO_LOGIN=1, no NODE_ENV fallback. Production fails closed
// unless the separate isolated-data attestation is also present.
const demoLoginEnabled =
  process.env.ENABLE_DEMO_LOGIN === '1' &&
  (process.env.NODE_ENV !== 'production' || process.env.DEMO_ISOLATED_DATA === '1');

if (demoLoginEnabled) {
  router.post('/demo', demoLimiter, async (_req: Request, res: Response) => {
    try {
      const prisma: PrismaClient = _req.app.locals.prisma;

      void cleanupExpiredDemoPrincipals(prisma);

      // Each visitor gets an independent principal. Standard logout can then
      // revoke only that visitor's JWT without affecting concurrent sessions.
      const demoSessionId = crypto.randomBytes(16).toString('hex');
      const demoExpiresAt = new Date(Date.now() + DEMO_TTL_SECONDS * 1000);
      const user = await prisma.user.create({
        data: {
          email: `demo-${demoSessionId}@bowin.app`,
          firstName: 'Demo',
          lastName: 'Visitor',
          role: 'admin', // safe only behind the isolated synthetic-data gate
          demoExpiresAt,
        },
      });

      const { createToken } = await import('../middleware/auth.js');
      const token = createToken(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
        },
        DEMO_TTL_SECONDS, // 4h, not the 7d default
      );

      res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
      setCsrfCookie(res);

      res.json({
        ...maybeTokenField(token),
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
        expiresIn: DEMO_TTL_SECONDS,
        message: 'Synthetic demo session active. All data in this environment is fabricated.',
      });
    } catch (err: unknown) {
      console.error('Demo login error:', err);
      res.status(500).json({ error: 'Demo login failed' });
    }
  });
}

export default router;

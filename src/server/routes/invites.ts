import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { invitationEmail } from '../services/email-templates.js';
import {
  validateEmail,
  validateBoundedString,
  validateRole,
  FIELD_LIMITS,
} from './field-validation.js';

const router = Router();

const INVITE_EXPIRY_HOURS = 72;

// Closes S22: per-IP rate limit on the public invite-verify
// endpoint. The token itself is 256-bit so brute-force is
// infeasible, but the route returns email + role for any
// matching token, which is a useful signal for an attacker
// enumerating; the limiter makes that enumeration slow.
const inviteVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite verifications, please slow down.' },
});

function getBaseUrl(): string {
  return process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
}

// POST /api/invites/send — Admin sends an invitation
router.post('/send', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { email, firstName, lastName, role } = req.body;

  // Field-level validation via the shared helpers (field-validation.ts).
  // The same regex + length caps apply to public.ts POST /register.
  const errors: string[] = [];
  const emailErr = validateEmail(email);
  if (emailErr) errors.push(emailErr);
  const fnErr = validateBoundedString(firstName, 'First name', FIELD_LIMITS.MAX_FIRST_NAME);
  if (fnErr) errors.push(fnErr);
  const lnErr = validateBoundedString(lastName, 'Last name', FIELD_LIMITS.MAX_LAST_NAME);
  if (lnErr) errors.push(lnErr);
  const roleErr = validateRole(role);
  if (roleErr) errors.push(roleErr);

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  try {
    // Check if user already exists. Prisma's case-insensitive
    // matching was added in 4.x — use it here so an existing user
    // with "User@Example.com" can't be duplicated by an invite
    // sent to "user@example.com". The previous behavior was
    // case-sensitive on `findUnique`, which let duplicates slip
    // through for any user whose existing email wasn't already
    // lowercase.
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
    });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Same case-insensitive check for an outstanding invite.
    const existingInvite = await prisma.invitation.findFirst({
      where: { email: { equals: email.toLowerCase(), mode: 'insensitive' }, status: 'pending' },
    });
    if (existingInvite) {
      return res.status(409).json({ error: 'A pending invitation already exists for this email' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        email: email.toLowerCase(),
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        role: role || 'viewer',
        token,
        tokenExpiry,
        invitedBy: req.user!.id,
      },
    });

    const inviteUrl = `${getBaseUrl()}/accept-invite?token=${token}`;
    const inviterName = `${req.user!.firstName} ${req.user!.lastName}`;

    const { subject, html } = invitationEmail({
      recipientName: firstName?.trim() || undefined,
      inviterName,
      role: role || 'viewer',
      inviteUrl,
      expiresInHours: INVITE_EXPIRY_HOURS,
    });

    const emailResult = await sendEmail(email.toLowerCase(), subject, html);

    res.status(201).json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        firstName: invitation.firstName,
        lastName: invitation.lastName,
        role: invitation.role,
        status: invitation.status,
        createdAt: invitation.createdAt,
      },
      emailSent: emailResult.success,
      emailError: emailResult.error,
    });
  } catch (error) {
    console.error('Send invitation error:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// GET /api/invites — Admin lists all invitations
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    // Mark expired invitations
    await prisma.invitation.updateMany({
      where: {
        status: 'pending',
        tokenExpiry: { lt: new Date() },
      },
      data: { status: 'expired' },
    });

    const invitations = await prisma.invitation.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        tokenExpiry: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(invitations);
  } catch (error) {
    console.error('List invitations error:', error);
    res.status(500).json({ error: 'Failed to list invitations' });
  }
});

// POST /api/invites/resend/:id — Admin resends an invitation
router.post('/resend/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { id } = req.params;

  try {
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    if (invitation.status === 'accepted') {
      return res.status(400).json({ error: 'Invitation already accepted' });
    }

    // Generate new token and expiry
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

    await prisma.invitation.update({
      where: { id },
      data: { token, tokenExpiry, status: 'pending' },
    });

    const inviteUrl = `${getBaseUrl()}/accept-invite?token=${token}`;
    const inviterName = `${req.user!.firstName} ${req.user!.lastName}`;

    const { subject, html } = invitationEmail({
      recipientName: invitation.firstName || undefined,
      inviterName,
      role: invitation.role,
      inviteUrl,
      expiresInHours: INVITE_EXPIRY_HOURS,
    });

    const emailResult = await sendEmail(invitation.email, subject, html);

    res.json({ emailSent: emailResult.success, emailError: emailResult.error });
  } catch (error) {
    console.error('Resend invitation error:', error);
    res.status(500).json({ error: 'Failed to resend invitation' });
  }
});

// DELETE /api/invites/:id — Admin cancels an invitation
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { id } = req.params;

  try {
    // Check existence first so we can return 404 instead of 500.
    // Prisma's `delete` throws P2025 if the row doesn't exist,
    // which the catch-all below would surface as a generic 500.
    const existing = await prisma.invitation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    await prisma.invitation.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('Cancel invitation error:', error);
    res.status(500).json({ error: 'Failed to cancel invitation' });
  }
});

// GET /api/invites/verify/:token — Public: verify an invite token
router.get('/verify/:token', inviteVerifyLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { token } = req.params;

  try {
    const invitation = await prisma.invitation.findUnique({
      where: { token },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tokenExpiry: true,
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invalid invitation token' });
    }

    if (invitation.status === 'accepted') {
      return res.status(400).json({ error: 'Invitation already accepted' });
    }

    if (invitation.tokenExpiry < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    res.json({
      email: invitation.email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      role: invitation.role,
    });
  } catch (error) {
    console.error('Verify invitation error:', error);
    res.status(500).json({ error: 'Failed to verify invitation' });
  }
});

export default router;

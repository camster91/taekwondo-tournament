import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { invitationEmail } from '../services/email-templates.js';
const router = Router();
const INVITE_EXPIRY_HOURS = 72;
function getBaseUrl() {
    return process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
}
// POST /api/invites/send — Admin sends an invitation
router.post('/send', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { email, firstName, lastName, role } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    const validRoles = ['admin', 'director', 'scorekeeper', 'viewer'];
    if (role && !validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });
        if (existingUser) {
            return res.status(409).json({ error: 'A user with this email already exists' });
        }
        // Check for pending invitation to same email
        const existingInvite = await prisma.invitation.findFirst({
            where: { email: email.toLowerCase(), status: 'pending' },
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
                invitedBy: req.user.id,
            },
        });
        const inviteUrl = `${getBaseUrl()}/accept-invite?token=${token}`;
        const inviterName = `${req.user.firstName} ${req.user.lastName}`;
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
    }
    catch (error) {
        console.error('Send invitation error:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});
// GET /api/invites — Admin lists all invitations
router.get('/', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
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
    }
    catch (error) {
        console.error('List invitations error:', error);
        res.status(500).json({ error: 'Failed to list invitations' });
    }
});
// POST /api/invites/resend/:id — Admin resends an invitation
router.post('/resend/:id', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
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
        const inviterName = `${req.user.firstName} ${req.user.lastName}`;
        const { subject, html } = invitationEmail({
            recipientName: invitation.firstName || undefined,
            inviterName,
            role: invitation.role,
            inviteUrl,
            expiresInHours: INVITE_EXPIRY_HOURS,
        });
        const emailResult = await sendEmail(invitation.email, subject, html);
        res.json({ emailSent: emailResult.success, emailError: emailResult.error });
    }
    catch (error) {
        console.error('Resend invitation error:', error);
        res.status(500).json({ error: 'Failed to resend invitation' });
    }
});
// DELETE /api/invites/:id — Admin cancels an invitation
router.delete('/:id', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { id } = req.params;
    try {
        await prisma.invitation.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error('Cancel invitation error:', error);
        res.status(500).json({ error: 'Failed to cancel invitation' });
    }
});
// GET /api/invites/verify/:token — Public: verify an invite token
router.get('/verify/:token', async (req, res) => {
    const prisma = req.app.locals.prisma;
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
    }
    catch (error) {
        console.error('Verify invitation error:', error);
        res.status(500).json({ error: 'Failed to verify invitation' });
    }
});
export default router;

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
const router = Router();
const orgCreateSchema = z.object({
    name: z.string().min(1, 'Organization name is required').max(200),
    slug: z.string().min(1, 'Slug is required').max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    plan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional().default('free'),
    settings: z.record(z.string(), z.unknown()).optional(),
});
const orgUpdateSchema = orgCreateSchema.partial().omit({ slug: true });
const memberRoleSchema = z.object({
    role: z.enum(['owner', 'admin', 'member']),
});
const addMemberSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
    role: z.enum(['owner', 'admin', 'member']).optional().default('member'),
});
const getParam = (param) => {
    if (Array.isArray(param))
        return param[0];
    return param || '';
};
// List all organizations (admin only)
router.get('/', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const orgs = await prisma.organization.findMany({
        include: {
            _count: {
                select: { members: true, tournaments: true },
            },
        },
        orderBy: { name: 'asc' },
    });
    res.json(orgs);
});
// Get organizations for current user
router.get('/my', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const memberships = await prisma.organizationMember.findMany({
        where: { userId: req.user.id },
        include: {
            organization: {
                include: {
                    _count: {
                        select: { members: true, tournaments: true },
                    },
                },
            },
        },
    });
    res.json(memberships.map((m) => ({ ...m.organization, memberRole: m.role })));
});
// Get single organization
router.get('/:id', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    // Must be admin or member
    if (req.user.role !== 'admin') {
        const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
        });
        if (!membership) {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        include: {
            members: {
                include: {
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true, role: true },
                    },
                },
                orderBy: { createdAt: 'asc' },
            },
            _count: {
                select: { tournaments: true },
            },
        },
    });
    if (!org) {
        return res.status(404).json({ error: 'Organization not found' });
    }
    res.json(org);
});
// Create organization (admin only)
router.post('/', authenticate, validateRequest(orgCreateSchema), async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { name, slug, plan, settings } = req.body;
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
        return res.status(409).json({ error: 'Slug already in use' });
    }
    const org = await prisma.organization.create({
        data: {
            name,
            slug,
            plan: plan || 'free',
            settings: settings ? JSON.stringify(settings) : null,
            members: {
                create: {
                    userId: req.user.id,
                    role: 'owner',
                },
            },
        },
        include: {
            _count: { select: { members: true, tournaments: true } },
        },
    });
    res.status(201).json(org);
});
// Update organization (admin or org owner/admin)
router.put('/:id', authenticate, validateRequest(orgUpdateSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    const { name, plan, settings } = req.body;
    if (req.user.role !== 'admin') {
        const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
        });
        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({ error: 'Admin or org owner access required' });
        }
    }
    const org = await prisma.organization.update({
        where: { id: orgId },
        data: {
            name,
            plan,
            settings: settings ? JSON.stringify(settings) : undefined,
        },
    });
    res.json(org);
});
// Delete organization (admin only)
router.delete('/:id', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    await prisma.organization.delete({ where: { id: orgId } });
    res.status(204).send();
});
// Add member to organization
router.post('/:id/members', authenticate, validateRequest(addMemberSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    const { userId, role } = req.body;
    if (req.user.role !== 'admin') {
        const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
        });
        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({ error: 'Org owner or admin access required' });
        }
    }
    const member = await prisma.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        update: { role },
        create: { organizationId: orgId, userId, role },
        include: {
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
    });
    res.status(201).json(member);
});
// Update member role
router.put('/:id/members/:userId', authenticate, validateRequest(memberRoleSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    const userId = getParam(req.params.userId);
    const { role } = req.body;
    if (req.user.role !== 'admin') {
        const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
        });
        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({ error: 'Org owner or admin access required' });
        }
    }
    const member = await prisma.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role },
    });
    res.json(member);
});
// Remove member from organization
router.delete('/:id/members/:userId', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    const userId = getParam(req.params.userId);
    if (req.user.role !== 'admin') {
        const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
        });
        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            // Allow users to remove themselves
            if (userId !== req.user.id) {
                return res.status(403).json({ error: 'Org owner or admin access required' });
            }
        }
    }
    await prisma.organizationMember.delete({
        where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    res.status(204).send();
});
// Get tournaments for an organization
router.get('/:id/tournaments', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const orgId = getParam(req.params.id);
    if (req.user.role !== 'admin') {
        const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
        });
        if (!membership) {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    const tournaments = await prisma.tournament.findMany({
        where: { organizationId: orgId },
        include: {
            _count: { select: { registrations: true, divisions: true } },
        },
        orderBy: { date: 'desc' },
    });
    res.json(tournaments);
});
export default router;

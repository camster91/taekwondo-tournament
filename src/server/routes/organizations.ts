import { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import {
  authenticate,
  requireRole,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { getPlanEntitlements } from '../services/entitlements.js';
import { validateOrganizationDeletion } from '../services/organization-closure.js';
import {
  normalizeOrganizationCreateInput,
  normalizePlanChangeInput,
} from './organizations-validation.js';

const router = Router();

function organizationWithoutSettings<T extends object>(organization: T): Omit<T, 'settings'> {
  const safe = { ...organization } as T & { settings?: unknown };
  delete safe.settings;
  return safe;
}

async function ownedOrganization(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
) {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: { include: { billingSubscription: true } } },
  });
  return membership?.role === 'owner' ? membership.organization : null;
}

router.get('/current', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.user!.id },
    include: {
      organization: {
        include: {
          billingSubscription: true,
          _count: { select: { members: true, tournaments: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    organizations: memberships.map(({ organization, role }) => ({
      ...organizationWithoutSettings(organization),
      membershipRole: role,
      entitlements: getPlanEntitlements(organization.plan),
    })),
  });
});

router.post(
  '/',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = normalizeOrganizationCreateInput(req.body ?? {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const prisma: PrismaClient = req.app.locals.prisma;
    if (req.user!.role !== 'admin') {
      const existingMembership = await prisma.organizationMember.findFirst({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (existingMembership) {
        return res.status(409).json({ error: 'This account already belongs to an organization.' });
      }
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { ...parsed.data, plan: 'free' },
        });
        const membership = await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: req.user!.id,
            role: 'owner',
          },
        });
        // A director's first organization adopts the org-less tournaments
        // they created. Org members can't see org-less tournaments, so
        // without this their earlier events would vanish on org creation.
        // Admins create orgs on behalf of others, so nothing moves for them.
        const adopted = req.user!.role === 'admin'
          ? { count: 0 }
          : await tx.tournament.updateMany({
            where: { createdById: req.user!.id, organizationId: null },
            data: { organizationId: organization.id },
          });
        return { organization, membership, adoptedTournamentCount: adopted.count };
      });
      res.status(201).json({
        ...result,
        organization: organizationWithoutSettings(result.organization),
        entitlements: getPlanEntitlements(result.organization.plan),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ error: 'That organization URL is already in use.' });
      }
      throw error;
    }
  },
);

router.post(
  '/:id/plan',
  authenticate,
  requireRole('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = normalizePlanChangeInput(req.body ?? {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const prisma: PrismaClient = req.app.locals.prisma;
    const existing = await prisma.organization.findUnique({
      where: { id: req.params.id },
      select: { id: true, plan: true },
    });
    if (!existing) return res.status(404).json({ error: 'Organization not found' });

    const active = parsed.data.plan !== 'free';
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({
        where: { id: existing.id },
        data: { plan: parsed.data.plan },
      });
      const billing = await tx.organizationBillingSubscription.upsert({
        where: { organizationId: existing.id },
        create: {
          organizationId: existing.id,
          provider: 'manual',
          status: active ? 'active' : 'inactive',
          plan: parsed.data.plan,
        },
        update: {
          provider: 'manual',
          status: active ? 'active' : 'inactive',
          plan: parsed.data.plan,
          providerCustomerId: null,
          providerSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
      });
      const audit = await tx.organizationPlanChange.create({
        data: {
          organizationId: existing.id,
          fromPlan: existing.plan,
          toPlan: parsed.data.plan,
          source: 'manual',
          reason: parsed.data.reason,
          changedBy: req.user!.id,
        },
      });
      return { organization, billing, audit };
    });

    res.json({
      ...result,
      organization: organizationWithoutSettings(result.organization),
      entitlements: getPlanEntitlements(result.organization.plan),
    });
  },
);

router.get('/:id/export', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const organization = await ownedOrganization(prisma, req.params.id, req.user!.id);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  const tournaments = await prisma.tournament.findMany({
    where: { organizationId: organization.id },
    include: {
      registrations: { include: { competitor: true } },
      divisions: {
        include: {
          assignments: true,
          bracket: { include: { matches: true } },
        },
      },
      weightClasses: true,
      rules: true,
      incidents: true,
      competitorHistories: true,
      matchupHistories: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: organization.id },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });

  res.setHeader('Content-Disposition', `attachment; filename="${organization.slug}-export.json"`);
  return res.json({
    exportedAt: new Date().toISOString(),
    organization: organizationWithoutSettings(organization),
    members,
    tournaments,
  });
});

router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const organization = await ownedOrganization(prisma, req.params.id, req.user!.id);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  const deletion = validateOrganizationDeletion({
    slug: organization.slug,
    confirmation: req.body?.confirmation,
    exportAcknowledged: req.body?.exportAcknowledged,
    billingStatus: organization.billingSubscription?.status ?? null,
  });
  if (!deletion.ok) return res.status(deletion.status).json({ error: deletion.error });

  await prisma.$transaction(async (tx) => {
    const tournaments = await tx.tournament.findMany({
      where: { organizationId: organization.id },
      select: {
        id: true,
        registrations: { select: { competitorId: true } },
      },
    });
    const competitorIds = [...new Set(tournaments.flatMap((item) => (
      item.registrations.map((registration) => registration.competitorId)
    )))];

    await tx.tournament.deleteMany({ where: { organizationId: organization.id } });
    await tx.organization.delete({ where: { id: organization.id } });
    if (competitorIds.length) {
      await tx.competitor.deleteMany({
        where: { id: { in: competitorIds }, registrations: { none: {} } },
      });
    }
  });

  return res.status(204).send();
});

export default router;

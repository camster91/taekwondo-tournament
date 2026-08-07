import { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import {
  authenticate,
  requireRole,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { getPlanEntitlements } from '../services/entitlements.js';
import {
  normalizeOrganizationCreateInput,
  normalizePlanChangeInput,
} from './organizations-validation.js';

const router = Router();

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
      ...organization,
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
        return { organization, membership };
      });
      res.status(201).json({
        ...result,
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

    res.json({ ...result, entitlements: getPlanEntitlements(result.organization.plan) });
  },
);

export default router;

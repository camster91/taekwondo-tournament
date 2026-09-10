import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import {
  authenticate,
  requireRole,
  type AuthenticatedRequest,
} from '../middleware/auth.js';

const router = Router();

const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

const templateCreateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(200),
  description: z.string().max(1000).optional().nullable(),
  sportProfileSlug: z.string().optional().default('taekwondo'),
  settings: z.record(z.string(), z.unknown()).optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
  weightClasses: z.array(z.object({
    name: z.string().min(1),
    gender: z.string().optional(),
    ageMin: z.number().int().optional(),
    ageMax: z.number().int().optional(),
    weightMinLbs: z.number().optional(),
    weightMaxLbs: z.number().optional(),
    displayOrder: z.number().int().optional(),
  })).optional(),
  brandName: z.string().max(200).optional().nullable(),
  brandPrimaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  brandLogoUrl: z.string().url().max(500).optional().nullable(),
});

const templateUpdateSchema = templateCreateSchema.partial();

// Get all templates for the user's organization
// Only returns templates from the user's org (fail-closed isolation)
router.get('/', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const includeDeleted = req.query.trash === 'true';
  const where = includeDeleted
    ? { organizationId: membership.organizationId }
    : { organizationId: membership.organizationId, deletedAt: null };

  const templates = await prisma.tournamentTemplate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  res.json(templates);
});

// Get single template (requires org membership)
router.get('/:id', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id },
    select: { organizationId: true },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const template = await prisma.tournamentTemplate.findFirst({
    where: {
      id,
      organizationId: membership.organizationId,
    },
  });

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  res.json(template);
});

// Create template (requires admin or director role + org membership)
router.post('/', authenticate, requireRole('admin', 'director'), validateRequest(templateCreateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const { name, description, sportProfileSlug, settings, rules, weightClasses, brandName, brandPrimaryColor, brandLogoUrl } = req.body;

  const template = await prisma.tournamentTemplate.create({
    data: {
      name,
      description: description || null,
      organizationId: membership.organizationId,
      sportProfileSlug: sportProfileSlug || 'taekwondo',
      settings: settings ? JSON.stringify(settings) : null,
      rules: rules ? JSON.stringify(rules) : null,
      weightClasses: weightClasses ? JSON.stringify(weightClasses) : null,
      brandName: brandName || null,
      brandPrimaryColor: brandPrimaryColor || null,
      brandLogoUrl: brandLogoUrl || null,
      createdBy: req.user.id,
    },
  });

  res.status(201).json(template);
});

// Update template (requires org membership + ownership check)
router.put('/:id', authenticate, requireRole('admin', 'director'), validateRequest(templateUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id },
    select: { organizationId: true },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const existing = await prisma.tournamentTemplate.findFirst({
    where: {
      id,
      organizationId: membership.organizationId,
      deletedAt: null,
    },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const { name, description, sportProfileSlug, settings, rules, weightClasses, brandName, brandPrimaryColor, brandLogoUrl } = req.body;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (sportProfileSlug !== undefined) updateData.sportProfileSlug = sportProfileSlug;
  if (settings !== undefined) updateData.settings = JSON.stringify(settings);
  if (rules !== undefined) updateData.rules = JSON.stringify(rules);
  if (weightClasses !== undefined) updateData.weightClasses = JSON.stringify(weightClasses);
  if (brandName !== undefined) updateData.brandName = brandName;
  if (brandPrimaryColor !== undefined) updateData.brandPrimaryColor = brandPrimaryColor;
  if (brandLogoUrl !== undefined) updateData.brandLogoUrl = brandLogoUrl;

  const template = await prisma.tournamentTemplate.update({
    where: { id },
    data: updateData,
  });

  res.json(template);
});

// Soft-delete template (requires org membership)
router.delete('/:id', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id },
    select: { organizationId: true },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const existing = await prisma.tournamentTemplate.findFirst({
    where: {
      id,
      organizationId: membership.organizationId,
    },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  await prisma.tournamentTemplate.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  res.json({ ok: true });
});

// Restore soft-deleted template (requires org membership)
router.post('/:id/restore', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id },
    select: { organizationId: true },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const existing = await prisma.tournamentTemplate.findFirst({
    where: {
      id,
      organizationId: membership.organizationId,
      deletedAt: { not: null },
    },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Deleted template not found' });
  }

  const template = await prisma.tournamentTemplate.update({
    where: { id },
    data: { deletedAt: null },
  });

  res.json(template);
});

export default router;

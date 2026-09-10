import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { calculateAge } from '../../shared/constants/age-groups.js';
import { generateSchedule, validateScheduleConfig, DEFAULT_CONFIG, type ScheduleConfig } from '../services/schedule-generator.js';
import { validateRequest } from '../middleware/validate.js';
import { authenticate, requireRole, requireTournamentAccess, buildTournamentAccessFilter, type AuthenticatedRequest } from '../middleware/auth.js';
import { generatePublicSlug, applySlugWithRetry, sanitizeBroadcastSubject } from './tournament-helpers.js';
// requireRole stays in use for POST / (create new tournament) — there's
// no parent tournament to scope-access yet. All other tournament-scoped
// mutations use requireTournamentAccess.
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { escapeHtml } from '../services/email-templates.js';
import {
  parseTournamentRules,
  serializeTournamentRules,
  DEFAULT_TOURNAMENT_RULES,
  type TournamentRules,
} from '../../shared/constants/tournament-rules.js';
import { Errors } from '../utils/errors.js';
import {
  canCreateTournament,
  canOpenPublicRegistration,
  canAddRegistration,
  canAddBulkRegistrations,
  getPlanEntitlements,
} from '../services/entitlements.js';
import { mergeGeneralSettings, mergeRulesSettings, saveTournamentSettingsAtomic, stripReservedOperationSettings, stripReservedOperationSettingsFromRaw } from '../services/tournament-settings.js';
import { createAuditLog, getClientIp, getUserAgent } from '../services/audit-log.js';
import { loadTournamentAttention } from '../services/tournament-attention.js';
import { answerOperationalQuery } from '../services/operational-query.js';
import { generateQRPoster } from '../services/qr-poster.js';
import { publicAppUrlFromEnv } from '../services/production-config.js';
import { recordTournamentUsage } from '../services/usage-metering.js';
import {
  applyScheduleCorrection,
  buildScheduleImpact,
  readStoredScheduleConfig,
  scheduleInputVersion,
  scheduleResultVersion,
  getScheduleOperationStatus,
  undoScheduleCorrection,
} from '../services/schedule-correction.js';
import { materializeCanonicalTournamentSchedule } from '../services/canonical-schedule.js';

const router = Router();

const operationalQuerySchema = z.object({
  question: z.string().trim().min(1, 'A question is required').max(500, 'Question is too long'),
});

// Validation schemas
const tournamentCreateSchema = z.object({
  name: z.string().min(1, 'Tournament name is required').max(200),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
  location: z.string().max(300).optional().nullable(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sportProfileSlug: z.string().optional().default('taekwondo'),
  organizationId: z.string().optional(),
});

const tournamentUpdateSchema = tournamentCreateSchema.partial().extend({
  status: z.enum(['draft', 'registration', 'brackets', 'in_progress', 'active', 'completed']).optional(),
  publicScoreboardRefreshMs: z.number().int().min(3000).max(60000).optional(),
  maxCapacity: z.number().int().min(1).optional().nullable(),
  waitlistEnabled: z.boolean().optional(),
});

const registrationSchema = z.object({
  competitorId: z.string().min(1, 'Competitor ID is required'),
  patterns: z.boolean().optional(),
  sparring: z.boolean().optional(),
  weightAtRegistration: z.number().positive().optional(),
});

const bulkRegistrationSchema = z.object({
  competitorIds: z.array(z.string()).min(1, 'At least one competitor required'),
  patterns: z.boolean().optional(),
  sparring: z.boolean().optional(),
});

const registrationUpdateSchema = z.object({
  patterns: z.boolean().optional(),
  sparring: z.boolean().optional(),
  weightAtRegistration: z.number().positive().optional(),
  checkedIn: z.boolean().optional(),
  checkInWeight: z.number().positive().optional(),
  // v2 fields
  competeWithOlder: z.boolean().optional(),
  specialNeeds: z.string().max(500).optional().nullable(),
  manualDivisionId: z.string().optional().nullable(),
  seeding: z.number().int().min(1).optional().nullable(),
  // Manual payment override for pilots without Stripe
  paymentStatus: z.enum(['not_required', 'pending', 'paid', 'waived', 'failed']).optional(),
});

const weightClassesSchema = z.object({
  weightClasses: z.array(z.object({
    name: z.string().min(1),
    gender: z.string().optional(),
    ageMin: z.number().int().optional(),
    ageMax: z.number().int().optional(),
    weightMinLbs: z.number().optional(),
    weightMaxLbs: z.number().optional(),
    displayOrder: z.number().int().optional(),
  })),
});

const atomicTournamentSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
  weightClasses: weightClassesSchema.shape.weightClasses,
});

const scheduleConfigSchema = z.object({
  startTime: z.string(), endTime: z.string(), ringCount: z.number().int().min(1).max(10),
  matchDurationMinutes: z.object({ patterns: z.number().positive(), sparring: z.number().positive() }),
  breakBetweenDivisions: z.number().min(0).max(30),
});

const scheduleApplySchema = z.object({
  config: scheduleConfigSchema,
  expectedUpdatedAt: z.string().datetime(),
  expectedInputVersion: z.string().length(64),
  operationKey: z.string().uuid(),
});

// Ring reassignment body — moves a division's matches to a different
// ring number. Closes the hand-rolled `if (!divisionId || !ring ||
// ring < 1)` validation that the audit flagged as inconsistent with
// the rest of the codebase (everything else uses validateRequest).
const ringReassignSchema = z.object({
  divisionId: z.string().uuid(),
  ring: z.number().int().min(1),
});

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Get all tournaments (requires authentication)
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // ?trash=true returns soft-deleted tournaments (for the Trash page);
  // ?trash=all returns both. Default hides soft-deleted.
  const trash = req.query.trash;
  const trashFilter =
    trash === 'true' ? { deletedAt: { not: null } } :
    trash === 'all' ? {} :
    { deletedAt: null };

  // Per-tournament access scoping — applies in multi-tenant installs.
  // Admin and single-tenant users (no orgs, no explicit access rows)
  // fall through to `null` which we spread as no-op.
  const accessFilter = await buildTournamentAccessFilter(req, prisma);

  // Hard server-side cap on the page size so a single request can't
  // fan out into a multi-megabyte payload. Response keeps the array
  // shape every client expects — pagination metadata can be added
  // later as an additive change once Dashboard / Tournaments have
  // a load-more control. 200 is comfortably above any real install.
  const tournaments = await prisma.tournament.findMany({
    where: {
      ...trashFilter,
      ...(accessFilter ?? {}),
    },
    include: {
      _count: {
        select: {
          registrations: true,
          divisions: true,
        },
      },
    },
    orderBy: { date: 'desc' },
    take: 200,
  });

  res.json(tournaments);
});

// Get single tournament (requires authentication)
router.get('/:id', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    include: {
      _count: {
        select: {
          registrations: true,
          divisions: true,
        },
      },
      weightClasses: true,
      organization: {
        select: {
          id: true,
          name: true,
          plan: true,
        },
      },
    },
  });

  if (!tournament || tournament.deletedAt) {
    // Return identical 404 whether the tournament never existed or was
    // soft-deleted. Mirrors the list endpoint's deletedAt filter so
    // a deleted tournament can't be reached by URL.
    return res.status(404).json({ error: 'Tournament not found' });
  }

  res.json(tournament);
});

// Create tournament (requires authentication + admin/director role)
router.post('/', authenticate, requireRole('admin', 'director'), validateRequest(tournamentCreateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  const { name, date, location, settings, sportProfileSlug, organizationId } = req.body;

  // Normalize the incoming date to noon UTC. The schema column is a
  // timestamptz but the field represents a calendar date, not an
  // instant. Storing at midnight UTC causes the date to shift by one
  // day when displayed in negative-offset timezones (e.g. PDT shows
  // "2026-08-14" for a date the user picked as 2026-08-15). Noon
  // UTC is safe across all timezones.
  const normalizeDate = (raw: string): Date => {
    const dateOnly = raw.includes('T') ? raw.slice(0, 10) : raw;
    return new Date(dateOnly + 'T12:00:00.000Z');
  };

  // organizationId is admin-only. Directors inherit their org from
  // membership — accepting a client-supplied orgId let a director
  // plant tournaments into another org (or leave orphans visible to
  // every global director via the null-org legacy fallback).
  let resolvedOrgId: string | null = null;
  if (authReq.user?.role === 'admin' && typeof organizationId === 'string' && organizationId) {
    resolvedOrgId = organizationId;
  } else if (authReq.user) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: authReq.user.id },
      select: { organizationId: true },
      orderBy: { createdAt: 'asc' },
    });
    resolvedOrgId = membership?.organizationId ?? null;
  }

  if (resolvedOrgId) {
    const organization = await prisma.organization.findUnique({
      where: { id: resolvedOrgId },
      select: { plan: true },
    });
    if (!organization) return res.status(404).json({ error: 'Organization not found' });
    const tournamentCount = await prisma.tournament.count({
      where: { organizationId: resolvedOrgId, deletedAt: null },
    });
    if (!canCreateTournament(organization.plan, tournamentCount)) {
      return res.status(402).json({
        error: 'Your organization has reached its tournament limit.',
        code: 'TOURNAMENT_LIMIT_REACHED',
      });
    }
  }

  const tournament = await prisma.tournament.create({
    data: {
      name,
      date: normalizeDate(date),
      location,
      settings: settings ? JSON.stringify(stripReservedOperationSettings(settings)) : null,
      status: 'draft',
      sportProfileSlug: sportProfileSlug || 'taekwondo',
      organizationId: resolvedOrgId,
    },
  });

  // Audit log: tournament created (P1-3)
  if (authReq.user) {
    await createAuditLog(prisma, {
      userId: authReq.user.id,
      action: 'tournament_created',
      details: { tournamentId: tournament.id, tournamentName: name },
      ipAddress: getClientIp(authReq),
      userAgent: getUserAgent(authReq),
      organizationId: resolvedOrgId || undefined,
      tournamentId: tournament.id,
    }).catch((err) => {
      console.error('[audit-log] tournament_created event failed:', err);
    });
  }

  res.status(201).json(tournament);
});

// Create tournament from template
router.post('/from-template/:templateId', authenticate, requireRole('admin', 'director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  const templateId = getParam(req.params.templateId);
  
  if (!authReq.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: authReq.user.id },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) {
    return res.status(403).json({ error: 'No organization membership found' });
  }

  const template = await prisma.tournamentTemplate.findFirst({
    where: {
      id: templateId,
      organizationId: membership.organizationId,
      deletedAt: null,
    },
  });

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const { name, date, location } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Tournament name is required' });
  }
  if (!date || typeof date !== 'string' || isNaN(Date.parse(date))) {
    return res.status(400).json({ error: 'Valid date is required' });
  }

  const normalizeDate = (raw: string): Date => {
    const dateOnly = raw.includes('T') ? raw.slice(0, 10) : raw;
    return new Date(dateOnly + 'T12:00:00.000Z');
  };

  const organization = await prisma.organization.findUnique({
    where: { id: membership.organizationId },
    select: { plan: true },
  });
  if (!organization) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const tournamentCount = await prisma.tournament.count({
    where: { organizationId: membership.organizationId, deletedAt: null },
  });
  if (!canCreateTournament(organization.plan, tournamentCount)) {
    return res.status(402).json({
      error: 'Your organization has reached its tournament limit.',
      code: 'TOURNAMENT_LIMIT_REACHED',
    });
  }

  const tournament = await prisma.tournament.create({
    data: {
      name: name.trim(),
      date: normalizeDate(date),
      location: typeof location === 'string' ? location : null,
      settings: template.settings,
      status: 'draft',
      sportProfileSlug: template.sportProfileSlug,
      organizationId: membership.organizationId,
      brandName: template.brandName,
      brandPrimaryColor: template.brandPrimaryColor,
      brandLogoUrl: template.brandLogoUrl,
    },
  });

  if (template.weightClasses) {
    try {
      const weightClasses = JSON.parse(template.weightClasses) as Array<{
        name: string;
        gender?: string;
        ageMin?: number;
        ageMax?: number;
        weightMinLbs?: number;
        weightMaxLbs?: number;
        displayOrder?: number;
      }>;
      
      await prisma.weightClass.createMany({
        data: weightClasses.map((wc) => ({
          tournamentId: tournament.id,
          name: wc.name,
          gender: wc.gender || null,
          ageMin: wc.ageMin ?? null,
          ageMax: wc.ageMax ?? null,
          weightMinLbs: wc.weightMinLbs ?? null,
          weightMaxLbs: wc.weightMaxLbs ?? null,
          displayOrder: wc.displayOrder ?? null,
        })),
      });
    } catch (err) {
      console.error('[create-from-template] Failed to parse/create weight classes:', err);
    }
  }

  if (template.rules) {
    try {
      const rules = JSON.parse(template.rules);
      const rulesData = Array.isArray(rules) ? rules : [rules];
      await prisma.tournamentRule.createMany({
        data: rulesData.map((rule: Record<string, unknown>) => ({
          tournamentId: tournament.id,
          name: String(rule.name || 'Custom Rule'),
          description: rule.description ? String(rule.description) : null,
          category: String(rule.category || 'custom'),
          ruleType: String(rule.ruleType || 'custom_constraint'),
          enforcement: String(rule.enforcement || 'soft'),
          parameters: typeof rule.parameters === 'string' ? rule.parameters : JSON.stringify(rule.parameters || {}),
          priority: typeof rule.priority === 'number' ? rule.priority : 50,
          isActive: rule.isActive === false ? false : true,
          source: 'manual',
          createdBy: authReq.user!.id,
        })),
      });
    } catch (err) {
      console.error('[create-from-template] Failed to parse/create rules:', err);
    }
  }

  if (authReq.user) {
    await createAuditLog(prisma, {
      userId: authReq.user.id,
      action: 'tournament_created',
      details: { tournamentId: tournament.id, tournamentName: name, fromTemplate: templateId },
      ipAddress: getClientIp(authReq),
      userAgent: getUserAgent(authReq),
      organizationId: membership.organizationId,
      tournamentId: tournament.id,
    }).catch((err) => {
      console.error('[audit-log] tournament_created (from template) event failed:', err);
    });
  }

  res.status(201).json(tournament);
});

// Update tournament (requires authentication + admin/director role)
// Generate or rotate the per-tournament public scoreboard slug.
// POST /api/tournaments/:id/public-slug — returns the new slug (or
// the existing one if the director wants to read it).
// Director-only; directors regenerate to revoke a leaked link.
router.post('/:id/public-slug', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);

  // 16 chars of base64url ≈ 80 bits of entropy. Brute-forcing is
  // impractical even at 10^9 attempts/s. The schema's @unique on
  // publicSlug means a collision would otherwise throw P2002 → 500.
  // Retry up to 3 times before giving up. The pure helper is in
  // tournament-helpers.ts so this can be tested in isolation.
  const result = await applySlugWithRetry({
    makeSlug: generatePublicSlug,
    update: (slug) => prisma.tournament.update({
      where: { id },
      data: { publicSlug: slug },
      select: { id: true, publicSlug: true },
    }),
    isP2002: (error) =>
      !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002',
  });

  res.json({ id: result.id, publicSlug: result.slug, attempts: result.attempts });
});

// Disable the public scoreboard by clearing the slug.
router.delete('/:id/public-slug', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);

  await prisma.tournament.update({
    where: { id },
    data: { publicSlug: null },
    select: { id: true, publicSlug: true },
  });

  res.json({ ok: true });
});

// Set event slug for tenant-branded portal URLs (/events/:orgSlug/:eventSlug)
// PUT /api/tournaments/:id/event-slug — sets or updates the event slug
router.put('/:id/event-slug', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  const { eventSlug } = req.body;

  // Import validation utilities
  const { validateSlug } = await import('../../shared/utils/slug-validation.js');

  // Validate slug format and reserved words
  const validation = validateSlug(eventSlug, 'event');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Check tournament exists and get its org
  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: { id: true, organizationId: true },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  if (!tournament.organizationId) {
    return res.status(400).json({
      error: 'Tournament must belong to an organization to use portal slugs',
    });
  }

  // Check uniqueness within organization scope
  const existing = await prisma.tournament.findFirst({
    where: {
      organizationId: tournament.organizationId,
      eventSlug: validation.normalized,
      NOT: { id }, // Exclude current tournament
    },
  });

  if (existing) {
    return res.status(409).json({
      error: `Event slug "${validation.normalized}" is already in use by another event in this organization`,
    });
  }

  // Update the tournament
  const updated = await prisma.tournament.update({
    where: { id },
    data: { eventSlug: validation.normalized },
    select: { id: true, eventSlug: true },
  });

  res.json(updated);
});

// Publish or unpublish event to portal
// POST /api/tournaments/:id/portal/publish — publish to portal
// POST /api/tournaments/:id/portal/unpublish — remove from portal
router.post('/:id/portal/:action', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);
  const action = req.params.action;

  if (action !== 'publish' && action !== 'unpublish') {
    return res.status(400).json({ error: 'Invalid action. Use "publish" or "unpublish"' });
  }

  // Check tournament exists and has required fields
  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      eventSlug: true,
      portalPublished: true,
      organization: {
        select: { slug: true },
      },
    },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  if (!tournament.organizationId || !tournament.organization) {
    return res.status(400).json({
      error: 'Tournament must belong to an organization to publish to portal',
    });
  }

  if (action === 'publish') {
    // Require event slug before publishing
    if (!tournament.eventSlug) {
      return res.status(400).json({
        error: 'Event slug is required before publishing. Set the event slug first.',
      });
    }

    // Publish
    const updated = await prisma.tournament.update({
      where: { id },
      data: {
        portalPublished: true,
        portalPublishedAt: tournament.portalPublished ? undefined : new Date(),
      },
      select: {
        id: true,
        eventSlug: true,
        portalPublished: true,
        portalPublishedAt: true,
        organization: {
          select: { slug: true },
        },
      },
    });

    res.json({
      ...updated,
      portalUrl: `/events/${updated.organization?.slug}/${updated.eventSlug}`,
    });
  } else {
    // Unpublish
    const updated = await prisma.tournament.update({
      where: { id },
      data: { portalPublished: false },
      select: {
        id: true,
        eventSlug: true,
        portalPublished: true,
      },
    });

    res.json(updated);
  }
});

// Generate QR code poster PDF for venue signage.
// GET /api/tournaments/:id/qr-poster — downloads a PDF with QR codes
// for public registration and live scoreboard.
router.get('/:id/qr-poster', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const id = getParam(req.params.id);

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      date: true,
      location: true,
      publicSlug: true,
      eventSlug: true,
      portalPublished: true,
      brandName: true,
      brandPrimaryColor: true,
      organizationId: true,
      organization: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!tournament || !tournament.publicSlug) {
    return res.status(400).json({
      error: 'Tournament must have a public scoreboard slug enabled to generate a poster. Enable it in Tournament Settings.',
    });
  }

  const publicUrl = publicAppUrlFromEnv(process.env);
  
  // Prefer portal URLs if event is published to portal
  let registrationUrl: string;
  let scoreboardUrl: string;
  
  if (tournament.portalPublished && tournament.eventSlug && tournament.organization?.slug) {
    // Portal-scoped URLs (tenant-branded)
    registrationUrl = `${publicUrl}/events/${tournament.organization.slug}/${tournament.eventSlug}`;
    // P2.5: Scoreboard URL must point to actual scoreboard display, not EventPortal
    scoreboardUrl = tournament.publicSlug
      ? `${publicUrl}/display/${tournament.id}?key=${encodeURIComponent(tournament.publicSlug)}`
      : `${publicUrl}/scoreboard/${tournament.publicSlug}`;
  } else {
    // Legacy UUID-based URLs (backward compatible)
    registrationUrl = `${publicUrl}/register/${tournament.id}`;
    scoreboardUrl = `${publicUrl}/display/${tournament.id}?key=${encodeURIComponent(tournament.publicSlug)}`;
  }

  const pdfBuffer = await generateQRPoster({
    tournamentName: tournament.name,
    tournamentDate: tournament.date.toISOString(),
    location: tournament.location,
    registrationUrl,
    scoreboardUrl,
    brandName: tournament.brandName,
    brandPrimaryColor: tournament.brandPrimaryColor ?? undefined,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${tournament.name.replace(/[^a-z0-9]/gi, '_')}_QR_Poster.pdf"`);
  res.send(pdfBuffer);
});

// Clone a tournament as a template for next year. Deep-copies settings
// (age groups, weight classes, fee note, division threshold) and resets
// all registrations / divisions / brackets. Closes M2 from the UI audit.
router.post('/:id/clone', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const original = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
  });
  if (!original || original.deletedAt) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Default the cloned tournament's date to +1 year at the same month/day,
  // unless the request supplies one. Default the name to "<original> (copy)"
  // unless the request overrides.
  const body = (req.body ?? {}) as { name?: string; date?: string; includeRegistrations?: boolean };
  const newDate = body.date ? new Date(body.date) : new Date(new Date(original.date).setFullYear(new Date(original.date).getFullYear() + 1));
  const newName = body.name?.trim() || `${original.name} (copy)`;

  const cloned = await prisma.tournament.create({
    data: {
      name: newName,
      date: new Date(newDate.toISOString().slice(0, 10) + 'T12:00:00.000Z'),
      location: original.location,
      status: 'draft',
      settings: stripReservedOperationSettingsFromRaw(original.settings),
      sportProfileSlug: original.sportProfileSlug,
      sportProfileId: original.sportProfileId,
      organizationId: original.organizationId,
    },
  });

  // Optional: copy the competitor list over too. Off by default since most
  // directors want a fresh roster for the new year. Toggle via the UI later.
  if (body.includeRegistrations) {
    const regs = await prisma.registration.findMany({ where: { tournamentId: original.id } });
    if (regs.length > 0) {
      await prisma.registration.createMany({
        data: regs.map((r) => ({
          competitorId: r.competitorId,
          tournamentId: cloned.id,
          patterns: r.patterns,
          sparring: r.sparring,
          weightAtRegistration: r.weightAtRegistration,
          ageAtTournament: r.ageAtTournament,
          parentName: r.parentName,
          parentEmail: r.parentEmail,
          parentPhone: r.parentPhone,
          heightAtRegistration: r.heightAtRegistration,
          reachAtRegistration: r.reachAtRegistration,
          experienceScore: r.experienceScore,
          skillEstimate: r.skillEstimate,
          competeWithOlder: r.competeWithOlder,
          specialNeeds: r.specialNeeds,
        })),
      });
    }
  }

  res.status(201).json(cloned);
});

// Send a broadcast email to every registered parent. Closes M1 from
// the UI audit — director can now do a "Tournament starts at 9am
// Saturday, bring water" without copy-pasting emails.
//
// Merge fields supported in subject + body:
//   {{tournament_name}} {{tournament_date}} {{tournament_location}}
//   {{competitor_first_name}} {{competitor_last_name}}
//   {{parent_first_name}}
//
// "test=true" sends only to req.user.email so the director can
// preview before blasting all parents.
router.post('/:id/broadcast', authenticate, requireTournamentAccess('director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { subject, body, test } = req.body as { subject?: string; body?: string; test?: boolean };

  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Subject and body are required.' });
  }
  if (!isEmailConfigured()) {
    return res.status(503).json({
      error: 'Email is not configured on this server. Set MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_FROM in the environment.',
    });
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    select: { name: true, date: true, location: true, deletedAt: true },
  });
  if (!tournament || tournament.deletedAt) {
    return res.status(404).json({ error: 'Tournament not found.' });
  }

  // Pull all registrations + competitor + parent contact info.
  const where: Record<string, unknown> = { tournamentId: getParam(req.params.id) };
  if (!test) {
    // Production sends go only to entries that have a parentEmail set.
    where.parentEmail = { not: null };
  }
  const regs = await prisma.registration.findMany({
    where,
    include: { competitor: true },
  });

  if (regs.length === 0) {
    return res.json({ sent: 0, failures: 0, message: 'No recipients matched.' });
  }

  // Closes S7: test mode now actually restricts the send to the
  // requesting director's own email. The previous implementation
  // sent to every parent regardless of the `test` flag, which
  // meant a director clicking "Send test" with placeholder text
  // would email every parent. We do this by replacing the `to`
  // address with the director's own email; the merge fields still
  // resolve from the first registration so the test preview
  // looks like a real send.
  const tDate = new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const directorEmail = req.user?.email?.trim();
  if (test && !directorEmail) {
    return res.status(400).json({ error: 'Test mode requires a signed-in director with an email on file.' });
  }

  let sent = 0;
  let failures = 0;

  for (const reg of regs) {
    const to = test
      ? directorEmail!
      : (reg.parentEmail || '').trim();
    if (!to) continue;
    const fill = (s: string) => s
      .replace(/\{\{tournament_name\}\}/g, tournament.name)
      .replace(/\{\{tournament_date\}\}/g, tDate)
      .replace(/\{\{tournament_location\}\}/g, tournament.location || 'TBD')
      .replace(/\{\{competitor_first_name\}\}/g, reg.competitor.firstName)
      .replace(/\{\{competitor_last_name\}\}/g, reg.competitor.lastName)
      .replace(/\{\{parent_first_name\}\}/g, (reg.parentName || '').split(' ')[0] || 'Parent');
    const filledSubject = fill(subject);
    const filledBody = fill(body);
    // Defensive subject normalization. Mailgun rejects subjects
    // containing CR/LF (which can break the RFC 5322 header) and
    // long subjects (>998 chars) can trigger SMTP truncation. A
    // director pasting multi-line content (e.g. a copy-paste from
    // another email) would otherwise fail with an opaque Mailgun
    // error — here we normalize to a single line and cap length.
    const safeSubject = sanitizeBroadcastSubject(filledSubject);
    // Escape HTML in body. Subjects don't render HTML but Apple
    // Mail + Outlook preview snippets can show truncated subject
    // text — escape so a director pasting HTML into the subject
    // doesn't surface as broken markup in a recipient's inbox.
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; white-space: pre-wrap;">${escapeHtml(filledBody)}</div>`;
    try {
      await sendEmail(to, safeSubject, html);
      sent++;
    } catch {
      failures++;
    }
  }

  res.json({
    sent,
    failures,
    total: regs.length,
    message: test
      ? `Test mode: sent ${sent} email(s) to the director (${directorEmail}) for preview.`
      : `Sent to ${sent} parent(s). ${failures} failed.`,
  });
});

router.put('/:id/settings', authenticate, requireTournamentAccess('director'), validateRequest(atomicTournamentSettingsSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournament = await saveTournamentSettingsAtomic(
    prisma,
    getParam(req.params.id),
    req.body.settings,
    req.body.weightClasses,
  );
  res.json(tournament);
});

router.get('/:id/attention', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const alerts = await loadTournamentAttention(prisma, getParam(req.params.id));
  if (!alerts) return res.status(404).json({ error: 'Tournament not found' });
  res.json({ alerts, generatedAt: new Date().toISOString() });
});

router.post('/:id/operational-query', authenticate, requireTournamentAccess('director'), validateRequest(operationalQuerySchema), async (req: Request, res: Response) => {
  const answer = await answerOperationalQuery(req.app.locals.prisma as PrismaClient, getParam(req.params.id), req.body.question);
  if (!answer) return res.status(404).json({ error: 'Tournament not found' });
  res.json(answer);
});

router.put('/:id', authenticate, requireTournamentAccess('director'), validateRequest(tournamentUpdateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { name, date, location, status, settings, publicScoreboardRefreshMs, maxCapacity, waitlistEnabled } = req.body;

  try {
    if (status === 'registration') {
      const existing = await prisma.tournament.findUnique({
        where: { id: getParam(req.params.id) },
        select: { organization: { select: { plan: true } } },
      });
      if (existing?.organization && !canOpenPublicRegistration(existing.organization.plan)) {
        return res.status(402).json({
          error: 'Public registration requires an active event plan.',
          code: 'PLAN_UPGRADE_REQUIRED',
        });
      }
    }
    const tournamentId = getParam(req.params.id);
    const tournament = await prisma.$transaction(async (tx) => {
      const current = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { settings: true, status: true, organizationId: true }
      });
      
      const updatedTournament = await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          name,
          date: date ? new Date(date) : undefined,
          location,
          status,
          settings: settings ? JSON.stringify(mergeGeneralSettings(current.settings, settings)) : undefined,
          publicScoreboardRefreshMs,
          maxCapacity: maxCapacity !== undefined ? maxCapacity : undefined,
          waitlistEnabled: waitlistEnabled !== undefined ? waitlistEnabled : undefined,
        },
      });

      // Record usage when tournament is completed
      if (status === 'completed' && current.status !== 'completed' && current.organizationId) {
        await recordTournamentUsage(tx as unknown as PrismaClient, tournamentId, current.organizationId);
      }

      return updatedTournament;
    }, { isolationLevel: 'Serializable' });

    res.json(tournament);
  } catch (error: unknown) {
    // Prisma throws P2025 when the row doesn't exist (the
    // requireTournamentAccess middleware already passed but the
    // row was hard-deleted between then and now, or the URL has a
    // typo). Map to 404 with the same shape as GET /:id so the
    // client gets a clear "not found" rather than a generic 500.
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    throw error;
  }
});

// ─── Tournament rules (v2) ──────────────────────────────────────────────
// GET /api/tournaments/:id/rules — returns the rules JSON for this tournament
router.get('/:id/rules', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    select: { settings: true },
  });
  if (!tournament) throw Errors.tournamentNotFound(getParam(req.params.id));
  const rules = parseTournamentRules(tournament.settings);
  res.json(rules);
});

// PUT /api/tournaments/:id/rules — replaces the rules JSON
// Closes S19: the previous version only round-tripped the body
// through parseTournamentRules (which merges with defaults and
// silently drops unknown keys). A director could POST any
// nested object and have it stored. Now there's an explicit
// shape check that rejects non-objects, and the round-trip
// through parseTournamentRules normalizes against the schema
// in src/shared/constants (so unknown keys are dropped, not
// stored).
router.put('/:id/rules', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { rules } = req.body as { rules: unknown };
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    return res.status(400).json({ error: 'rules must be an object' });
  }
  // Round-trip through parse (which validates shape and merges
  // with defaults). Anything the schema doesn't know about is
  // dropped silently.
  const normalized = parseTournamentRules(JSON.stringify(rules));
  const tournamentId = getParam(req.params.id);
  const tournament = await prisma.$transaction(async (tx) => {
    const existing = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
    return tx.tournament.update({
      where: { id: tournamentId },
      data: { settings: JSON.stringify(mergeRulesSettings(existing.settings, JSON.parse(serializeTournamentRules(normalized)))) },
      select: { id: true, settings: true },
    });
  }, { isolationLevel: 'Serializable' });
  res.json({ rules: parseTournamentRules(tournament.settings) });
});

// POST /api/tournaments/:id/rules/reset — restore defaults
router.post('/:id/rules/reset', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);
  const tournament = await prisma.$transaction(async (tx) => {
    const existing = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { settings: true } });
    return tx.tournament.update({
      where: { id: tournamentId },
      data: { settings: JSON.stringify(mergeRulesSettings(existing.settings, JSON.parse(serializeTournamentRules(DEFAULT_TOURNAMENT_RULES)))) },
      select: { id: true, settings: true },
    });
  }, { isolationLevel: 'Serializable' });
  res.json({ rules: parseTournamentRules(tournament.settings) });
});

// Delete tournament (requires authentication + admin/director role)
// Delete a tournament. The Tournament table has a deletedAt column
// (see prisma/schema.prisma) for soft-delete. Hard-deleting a tournament
// cascades through Match (SetNull), Division (cascade-delete), and
// Registration (cascade-delete) — losing the entire bracket history.
// The default is therefore a soft-delete that preserves audit trail;
// a separate ?hard=true flag is required to actually drop the row.
router.delete('/:id', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const hard = req.query.hard === 'true';
  const authReq = req as AuthenticatedRequest;
  const tournamentId = getParam(req.params.id);

  // Fetch tournament name for audit log before deletion
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { name: true, organizationId: true },
  });

  if (hard) {
    await prisma.tournament.delete({
      where: { id: tournamentId },
    });

    // Audit log: tournament hard-deleted (P1-3)
    if (authReq.user && tournament) {
      await createAuditLog(prisma, {
        userId: authReq.user.id,
        action: 'tournament_deleted',
        details: { tournamentId, tournamentName: tournament.name, hardDelete: true },
        ipAddress: getClientIp(authReq),
        userAgent: getUserAgent(authReq),
        organizationId: tournament.organizationId || undefined,
      }).catch((err) => {
        console.error('[audit-log] tournament_deleted event failed:', err);
      });
    }

    return res.status(204).send();
  }

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { deletedAt: new Date() },
  });

  // Audit log: tournament soft-deleted (P1-3)
  if (authReq.user && tournament) {
    await createAuditLog(prisma, {
      userId: authReq.user.id,
      action: 'tournament_deleted',
      details: { tournamentId, tournamentName: tournament.name, hardDelete: false },
      ipAddress: getClientIp(authReq),
      userAgent: getUserAgent(authReq),
      organizationId: tournament.organizationId || undefined,
      tournamentId,
    }).catch((err) => {
      console.error('[audit-log] tournament_deleted event failed:', err);
    });
  }

  res.status(204).send();
});

// Restore a soft-deleted tournament
router.post('/:id/restore', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  const tournamentId = getParam(req.params.id);

  // Fetch tournament info for audit log
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { name: true, organizationId: true },
  });

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { deletedAt: null },
  });

  // Audit log: tournament restored (P1-3)
  if (authReq.user && tournament) {
    await createAuditLog(prisma, {
      userId: authReq.user.id,
      action: 'tournament_restored',
      details: { tournamentId, tournamentName: tournament.name },
      ipAddress: getClientIp(authReq),
      userAgent: getUserAgent(authReq),
      organizationId: tournament.organizationId || undefined,
      tournamentId,
    }).catch((err) => {
      console.error('[audit-log] tournament_restored event failed:', err);
    });
  }

  res.status(204).send();
});

// Get tournament registrations (requires authentication)
router.get('/:id/registrations', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { notInDivision } = req.query;

  const where: Record<string, unknown> = {
    tournamentId: getParam(req.params.id),
    // Only show active and promoted registrations (exclude waitlisted).
    // Ensures check-in sees all completed public registrations (#187).
    waitlistStatus: { in: ['active', 'promoted'] },
  };
  // `?notInDivision=<id>` returns only registrations that have no
  // DivisionAssignment for this specific division. Used by the
  // BracketEditor "Add competitor" picker. Closes H2 from the UI audit.
  if (notInDivision && typeof notInDivision === 'string') {
    where.assignments = { none: { divisionId: notInDivision } };
  }

  const registrations = await prisma.registration.findMany({
    where,
    select: {
      id: true,
      competitorId: true,
      tournamentId: true,
      patterns: true,
      sparring: true,
      checkedIn: true,
      checkInTime: true,
      checkInWeight: true,
      weightAtRegistration: true,
      ageAtTournament: true,
      competeWithOlder: true,
      specialNeeds: true,
      manualDivisionId: true,
      seeding: true,
      parentName: true,
      parentEmail: true,
      parentPhone: true,
      competitor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          gender: true,
          belt: true,
          beltStripe: true,
          danRank: true,
          weightLbs: true,
          dateOfBirth: true,
          schoolDojang: true,
          specialNeeds: true,
        },
      },
      assignments: {
        select: {
          id: true,
          seedPosition: true,
          division: {
            select: {
              id: true,
              name: true,
              eventType: true,
              beltLevel: true,
              gender: true,
            },
          },
        },
      },
    },
    orderBy: {
      competitor: {
        lastName: 'asc',
      },
    },
    // Hard cap — check-in / assign UIs should page if they ever hit this.
    take: 5000,
  });

  res.json(registrations);
});

// Get tournament capacity status
router.get('/:id/capacity', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { getTournamentCapacityStatus } = await import('../services/waitlist.js');

  const status = await getTournamentCapacityStatus(prisma, getParam(req.params.id));

  if (!status) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  res.json(status);
});

// Get waitlisted registrations for a tournament
router.get('/:id/registrations/waitlist', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  const waitlisted = await prisma.registration.findMany({
    where: {
      tournamentId: getParam(req.params.id),
      waitlistStatus: 'waitlisted',
    },
    select: {
      id: true,
      waitlistPosition: true,
      waitlistPromotedAt: true,
      patterns: true,
      sparring: true,
      parentName: true,
      parentEmail: true,
      parentPhone: true,
      createdAt: true,
      competitor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          gender: true,
          belt: true,
          danRank: true,
          weightLbs: true,
          dateOfBirth: true,
          schoolDojang: true,
        },
      },
    },
    orderBy: {
      waitlistPosition: 'asc',
    },
  });

  res.json(waitlisted);
});

// Promote a waitlisted registration to active
router.post('/:id/registrations/:regId/promote', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  const registrationId = getParam(req.params.regId);
  const tournamentId = getParam(req.params.id);

  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      competitor: true,
      tournament: {
        select: {
          id: true,
          name: true,
          date: true,
          brandName: true,
          maxCapacity: true,
          organizationId: true,
          organization: {
            select: { brandName: true },
          },
        },
      },
    },
  });

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  // Verify registration belongs to this tournament
  if (registration.tournamentId !== tournamentId) {
    return res.status(400).json({ error: 'Registration does not belong to this tournament' });
  }

  if (registration.waitlistStatus !== 'waitlisted') {
    return res.status(400).json({ error: 'Registration is not waitlisted' });
  }

  // Check if tournament has available capacity
  const { getTournamentCapacityStatus } = await import('../services/waitlist.js');
  const capacityStatus = await getTournamentCapacityStatus(prisma, tournamentId);

  if (capacityStatus && capacityStatus.maxCapacity && capacityStatus.spotsRemaining === 0) {
    return res.status(400).json({
      error: 'Tournament is at full capacity. Cannot promote from waitlist.',
      capacity: capacityStatus,
    });
  }

  // Generate a new management token for the promoted registration
  const newManagementToken = generateManagementToken();
  const newExpiry = getManagementTokenExpiry(); // 30 days

  // Promote in transaction to ensure atomicity
  await prisma.$transaction(async (tx) => {
    // Promote the registration
    await tx.registration.update({
      where: { id: registrationId },
      data: {
        waitlistStatus: 'promoted',
        waitlistPromotedAt: new Date(),
        waitlistPosition: null,
        managementTokenHash: hashManagementToken(newManagementToken),
        managementTokenExpiresAt: newExpiry,
        managementTokenRevokedAt: null,
      },
    });

    // Renumber remaining waitlist
    const remaining = await tx.registration.findMany({
      where: {
        tournamentId,
        waitlistStatus: 'waitlisted',
      },
      orderBy: { waitlistPosition: 'asc' },
    });

    for (let i = 0; i < remaining.length; i++) {
      await tx.registration.update({
        where: { id: remaining[i].id },
        data: { waitlistPosition: i + 1 },
      });
    }

    // Audit log
    if (authReq.user) {
      await createAuditLog(tx as unknown as PrismaClient, {
        userId: authReq.user.id,
        action: 'waitlist_promoted',
        details: {
          registrationId,
          competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
          tournamentId,
          tournamentName: registration.tournament.name,
        },
        ipAddress: getClientIp(authReq),
        userAgent: getUserAgent(authReq),
        organizationId: registration.tournament.organizationId || undefined,
        tournamentId,
      }).catch((err) => {
        console.error('[audit-log] waitlist_promoted event failed:', err);
      });
    }
  });

  // Send promotion email
  if (registration.parentEmail && isEmailConfigured()) {
    const { waitlistPromotionEmail } = await import('../services/email-templates.js');
    const organizerBrandName = registration.tournament.brandName || registration.tournament.organization?.brandName || undefined;
    const managementUrl = `${process.env.PUBLIC_APP_URL || ''}/manage-registration?token=${encodeURIComponent(newManagementToken)}`;

    const { subject, html } = waitlistPromotionEmail({
      competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
      tournamentName: registration.tournament.name,
      tournamentDate: registration.tournament.date,
      confirmationCode: registration.id.slice(0, 8),
      managementUrl,
      organizerBrandName,
    });

    sendEmail(registration.parentEmail, subject, html).catch((err) => {
      console.error('[waitlist/promote] email failed:', err);
    });
  }

  res.json({ success: true, message: 'Registration promoted from waitlist' });
});

// Register competitor to tournament (requires authentication + admin/director role)
router.post('/:id/registrations', authenticate, requireTournamentAccess('director'), validateRequest(registrationSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { competitorId, patterns, sparring, weightAtRegistration } = req.body;

  // Get tournament date for age calculation
  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    include: { organization: { select: { plan: true } } },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Check competitor limit for free plan
  const plan = tournament.organization?.plan ?? 'free';
  const existingCount = await prisma.registration.count({
    where: { tournamentId: getParam(req.params.id) },
  });

  if (!canAddRegistration(plan, existingCount)) {
    const entitlements = getPlanEntitlements(plan);
    return res.status(402).json({
      error: `Your ${plan} plan is limited to ${entitlements.maxCompetitorsPerTournament} competitors per tournament. Upgrade to add more competitors.`,
      code: 'COMPETITOR_LIMIT_REACHED',
      limit: entitlements.maxCompetitorsPerTournament,
      current: existingCount,
    });
  }

  // Get competitor for age calculation
  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
  });

  if (!competitor) {
    return res.status(404).json({ error: 'Competitor not found' });
  }

  const ageAtTournament = calculateAge(competitor.dateOfBirth, tournament.date);

  const registration = await prisma.registration.create({
    data: {
      tournamentId: getParam(req.params.id),
      competitorId,
      patterns: patterns ?? false,
      sparring: sparring ?? false,
      weightAtRegistration: weightAtRegistration ?? competitor.weightLbs,
      ageAtTournament,
    },
    include: {
      competitor: true,
    },
  });

  res.status(201).json(registration);
});

// Bulk register competitors (requires authentication + admin/director role)
router.post('/:id/registrations/bulk', authenticate, requireTournamentAccess('director'), validateRequest(bulkRegistrationSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { competitorIds, patterns, sparring } = req.body;

  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    include: { organization: { select: { plan: true } } },
  });

  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Check competitor limit for free plan
  const plan = tournament.organization?.plan ?? 'free';
  const existingCount = await prisma.registration.count({
    where: { tournamentId: getParam(req.params.id) },
  });

  if (!canAddBulkRegistrations(plan, existingCount, competitorIds.length)) {
    const entitlements = getPlanEntitlements(plan);
    return res.status(402).json({
      error: `Your ${plan} plan is limited to ${entitlements.maxCompetitorsPerTournament} competitors per tournament. You have ${existingCount} registered and are trying to add ${competitorIds.length} more. Upgrade to add more competitors.`,
      code: 'COMPETITOR_LIMIT_REACHED',
      limit: entitlements.maxCompetitorsPerTournament,
      current: existingCount,
      requested: competitorIds.length,
    });
  }

  const competitors = await prisma.competitor.findMany({
    where: { id: { in: competitorIds } },
  });

  // Closes B28: wrap the upserts in a $transaction so a mid-loop
  // failure (e.g. DB connection drop, constraint violation) rolls
  // back the partial state. The previous Promise.all without a
  // transaction could leave 25 of 30 kids registered with no
  // signal of which ones failed.
  const registrations = await prisma.$transaction(
    competitors.map((competitor) => {
      const ageAtTournament = calculateAge(competitor.dateOfBirth, tournament.date);
      return prisma.registration.upsert({
        where: {
          tournamentId_competitorId: {
            tournamentId: getParam(req.params.id),
            competitorId: competitor.id,
          },
        },
        update: {
          patterns: patterns ?? false,
          sparring: sparring ?? false,
          ageAtTournament,
        },
        create: {
          tournamentId: getParam(req.params.id),
          competitorId: competitor.id,
          patterns: patterns ?? false,
          sparring: sparring ?? false,
          weightAtRegistration: competitor.weightLbs,
          ageAtTournament,
        },
      });
    })
  );

  res.json({ registered: registrations.length });
});

// Update registration (requires authentication + admin/director role)
router.put('/:id/registrations/:regId', authenticate, requireTournamentAccess('director'), validateRequest(registrationUpdateSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { patterns, sparring, weightAtRegistration, checkedIn, checkInWeight, competeWithOlder, specialNeeds, manualDivisionId, seeding, paymentStatus } = req.body;

  // Verify registration belongs to this tournament
  const existing = await prisma.registration.findFirst({
    where: { id: getParam(req.params.regId), tournamentId: getParam(req.params.id) },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Registration not found in this tournament' });
  }

  const updateData: Record<string, unknown> = {};
  if (patterns !== undefined) updateData.patterns = patterns;
  if (sparring !== undefined) updateData.sparring = sparring;
  if (weightAtRegistration !== undefined) updateData.weightAtRegistration = weightAtRegistration;
  if (checkedIn !== undefined) {
    updateData.checkedIn = checkedIn;
    updateData.checkInTime = checkedIn ? new Date() : null;
  }
  if (checkInWeight !== undefined) updateData.checkInWeight = checkInWeight;
  // v2 fields
  if (competeWithOlder !== undefined) updateData.competeWithOlder = competeWithOlder;
  if (specialNeeds !== undefined) updateData.specialNeeds = specialNeeds;
  if (manualDivisionId !== undefined) updateData.manualDivisionId = manualDivisionId || null;
  if (seeding !== undefined) updateData.seeding = seeding || null;
  // Manual payment override (for pilots without Stripe: mark paid/waived/failed manually)
  if (paymentStatus !== undefined) {
    updateData.paymentStatus = paymentStatus;
    // Set paymentReceivedAt when marking as paid or waived manually
    if (paymentStatus === 'paid' || paymentStatus === 'waived') {
      updateData.paymentReceivedAt = existing.paymentReceivedAt || new Date();
    } else if (paymentStatus === 'pending' || paymentStatus === 'failed') {
      updateData.paymentReceivedAt = null;
    }
  }

  const registration = await prisma.registration.update({
    where: { id: getParam(req.params.regId) },
    data: updateData,
    include: {
      competitor: true,
    },
  });

  res.json(registration);
});

// Remove registration (requires authentication + admin/director role)
router.delete('/:id/registrations/:regId', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  // Verify registration belongs to this tournament
  const existing = await prisma.registration.findFirst({
    where: { id: getParam(req.params.regId), tournamentId: getParam(req.params.id) },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Registration not found in this tournament' });
  }

  await prisma.registration.delete({
    where: { id: getParam(req.params.regId) },
  });

  res.status(204).send();
});

// Revoke or rotate a registration management token.
// POST /api/tournaments/:id/registrations/:regId/revoke-token
// Directors can revoke a leaked/lost token and optionally re-issue a fresh one.
// Closes #118 acceptance: revocation + rotation support.
router.post('/:id/registrations/:regId/revoke-token', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { reissue } = req.body; // boolean: rotate (generate new token) or just revoke?

  // Verify registration belongs to this tournament
  const registration = await prisma.registration.findFirst({
    where: { id: getParam(req.params.regId), tournamentId: getParam(req.params.id) },
    include: {
      competitor: { select: { firstName: true, lastName: true } },
      tournament: { select: { name: true } },
    },
  });

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found in this tournament' });
  }

  // If no token exists and reissue=false, cannot revoke nothing
  if (!registration.managementTokenHash && !reissue) {
    return res.status(400).json({ error: 'This registration has no management token to revoke (legacy registration or no parent email). Use reissue:true to issue a first token.' });
  }

  // If token exists, revoke it first (mark as revoked so it stops working)
  if (registration.managementTokenHash) {
    await prisma.registration.update({
      where: { id: registration.id },
      data: { managementTokenRevokedAt: new Date() },
    });

    // #118 acceptance: audit logging (non-sensitive)
    console.log(`[registration-token-revoke] Registration ${registration.id.slice(0, 8)} (tournament: ${registration.tournament.name}) token revoked by director`);
  }

  // If reissue=true, generate a new token and return it (works for both rotation and first-time issuance)
  if (reissue) {
    const { generateManagementToken, getManagementTokenExpiry, hashManagementToken } = await import('../utils/registration-management-token.js');
    const newToken = generateManagementToken();
    const newExpiry = getManagementTokenExpiry();

    await prisma.registration.update({
      where: { id: registration.id },
      data: {
        managementTokenHash: hashManagementToken(newToken),
        managementTokenExpiresAt: newExpiry,
        managementTokenRevokedAt: null, // clear revocation flag for new token
      },
    });

    // #118 acceptance: audit logging (non-sensitive)
    const action = registration.managementTokenHash ? 'rotate' : 'issue';
    console.log(`[registration-token-${action}] Registration ${registration.id.slice(0, 8)} issued new management token, expires ${newExpiry.toISOString()}`);

    return res.json({
      success: true,
      message: registration.managementTokenHash ? 'Old token revoked and new token generated' : 'New management token generated',
      managementToken: newToken,
      expiresAt: newExpiry,
      managementUrl: `${process.env.PUBLIC_APP_URL || ''}/manage-registration?token=${encodeURIComponent(newToken)}`,
    });
  }

  // Just revoked, no re-issue
  res.json({
    success: true,
    message: 'Management token revoked',
  });
});

// Get weight classes for tournament (requires authentication)
router.get('/:id/weight-classes', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const weightClasses = await prisma.weightClass.findMany({
    where: { tournamentId: getParam(req.params.id) },
    orderBy: [{ ageMin: 'asc' }, { gender: 'asc' }, { weightMinLbs: 'asc' }],
  });
  res.json(weightClasses);
});

// Save weight classes for tournament (bulk replace, requires authentication + admin/director role)
router.put('/:id/weight-classes', authenticate, requireTournamentAccess('director'), validateRequest(weightClassesSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);
  const { weightClasses } = req.body;

  // Delete existing and recreate
  await prisma.weightClass.deleteMany({ where: { tournamentId } });

  const created = await prisma.weightClass.createMany({
    data: weightClasses.map((wc: z.infer<typeof weightClassesSchema>['weightClasses'][number], i: number) => ({
      tournamentId,
      name: wc.name,
      gender: wc.gender || null,
      ageMin: wc.ageMin ?? null,
      ageMax: wc.ageMax ?? null,
      weightMinLbs: wc.weightMinLbs ?? null,
      weightMaxLbs: wc.weightMaxLbs ?? null,
      displayOrder: wc.displayOrder ?? i,
    })),
  });

  res.json({ saved: created.count });
});

// Generate tournament schedule (requires authentication)
router.post('/:id/schedule/preview', authenticate, requireTournamentAccess('director'), validateRequest(z.object({ config: scheduleConfigSchema })), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);
  const proposedConfig = req.body.config as ScheduleConfig;
  validateScheduleConfig(proposedConfig);
  const preview = await prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        settings: true, updatedAt: true, organization: { select: { plan: true } },
        divisions: {
          where: { deletedAt: null },
          select: {
            id: true, name: true, eventType: true, beltLevel: true, gender: true, ageMin: true, ageMax: true,
            assignments: { select: { registrationId: true, registration: { select: { competitor: { select: { firstName: true, lastName: true } } } } } },
          },
        },
      },
    });
    if (!tournament) return null;
    if (tournament.organization) {
      const { maxRings } = getPlanEntitlements(tournament.organization.plan);
      if (proposedConfig.ringCount > maxRings) throw new Error(`Your plan supports up to ${maxRings} rings.`);
    }
    const before = materializeCanonicalTournamentSchedule(
      await generateSchedule(tx as never, tournamentId, readStoredScheduleConfig(tournament.settings)),
      tournament.settings,
    );
    const after = await generateSchedule(tx as never, tournamentId, proposedConfig);
    return {
      before, after, proposedConfig, impact: buildScheduleImpact(before, after),
      expectedUpdatedAt: tournament.updatedAt.toISOString(),
      expectedInputVersion: scheduleInputVersion(tournament.divisions),
      operationKey: crypto.randomUUID(),
    };
  }, { isolationLevel: 'Serializable' });
  if (!preview) return res.status(404).json({ error: 'Tournament not found' });
  res.json(preview);
});

router.post('/:id/schedule', authenticate, requireTournamentAccess('director'), validateRequest(scheduleApplySchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);
  const configOverrides = req.body.config as ScheduleConfig;
  const authReq = req as AuthenticatedRequest;

  try {
    // Resolve the merged config so we can validate it before handing
    // it off. The service also validates internally; this gives us
    // an early, clear 400 before any DB calls.
    const mergedConfig: ScheduleConfig = { ...DEFAULT_CONFIG, ...configOverrides };
    validateScheduleConfig(mergedConfig);

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { organization: { select: { plan: true } }, settings: true, updatedAt: true },
    });
    if (tournament?.organization) {
      const { maxRings } = getPlanEntitlements(tournament.organization.plan);
      if (mergedConfig.ringCount > maxRings) {
        return res.status(402).json({
          error: `Your plan supports up to ${maxRings} rings.`,
          code: 'RING_LIMIT_REACHED',
        });
      }
    }

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const before = materializeCanonicalTournamentSchedule(
      await generateSchedule(prisma, tournamentId, readStoredScheduleConfig(tournament.settings)),
      tournament.settings,
    );
    const schedule = await generateSchedule(prisma, tournamentId, mergedConfig);
    const impact = buildScheduleImpact(before, schedule);
    const applied = await applyScheduleCorrection(prisma, {
      tournamentId,
      config: mergedConfig,
      expectedUpdatedAt: req.body.expectedUpdatedAt,
      expectedInputVersion: req.body.expectedInputVersion,
      resultVersion: scheduleResultVersion(schedule),
      operationKey: req.body.operationKey,
      approvedBy: authReq.user!.id,
      impact,
    });
    res.json({ ...schedule, impact: applied.impact ?? impact, auditId: applied.auditId });
  } catch (error: unknown) {
    // Validation errors get a 400; never echo raw Error.message —
    // schedule config may embed internal details and Prisma errors
    // can leak schema/connection hints.
    console.error('[schedule] POST generation failed:', error);
    const isValidation =
      error instanceof Error &&
      /invalid|required|must be|config/i.test(error.message);
    const stale = error instanceof Error && error.message === 'Schedule preview is stale';
    res.status(stale ? 409 : 400).json({
      error: stale
        ? 'Schedule preview is stale. Review the latest schedule before applying.'
        : isValidation && error instanceof Error
        ? error.message
        : 'Schedule generation failed',
    });
  }
});

router.get('/:id/schedule/operations/:operationKey', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const status = await getScheduleOperationStatus(prisma, getParam(req.params.id), getParam(req.params.operationKey));
  if (!status) return res.status(404).json({ error: 'Schedule operation not found' });
  res.json(status);
});

router.post('/:id/schedule/undo/:auditId', authenticate, requireTournamentAccess('director'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  try {
    await undoScheduleCorrection(prisma, getParam(req.params.auditId), authReq.user!.id, new Date(), getParam(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Schedule change cannot be undone' });
  }
});

// Get tournament schedule (requires authentication)
router.get('/:id/schedule', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const tournamentId = getParam(req.params.id);
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { settings: true } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const schedule = materializeCanonicalTournamentSchedule(
      await generateSchedule(prisma, tournamentId, readStoredScheduleConfig(tournament.settings)),
      tournament.settings,
    );
    res.json(schedule);
  } catch (error: unknown) {
    console.error('[schedule] GET generation failed:', error);
    res.status(400).json({ error: 'Schedule generation failed' });
  }
});

// Day-of operations: live stats for the running tournament
router.get('/:id/day-of', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const tournamentId = getParam(req.params.id);

  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  // All registrations with check-in status
  const [registrations, divisions, matches] = await Promise.all([
    prisma.registration.findMany({
      where: { tournamentId },
      include: { competitor: { select: { firstName: true, lastName: true, schoolDojang: true, belt: true, weightLbs: true } } },
    }),
    prisma.division.findMany({
      where: { tournamentId },
      include: { _count: { select: { assignments: true } } },
    }),
    // Closes P5: the day-of endpoint is polled every 3-10s by the
    // director dashboard, public scoreboard, and school portal.
    // The previous `findMany` with a `bracket: { include: {...} }`
    // returned every match column (notes, score1, score2, winnerId,
    // createdAt, updatedAt, ...) plus the bracket relation. For a
    // 500-match tournament that's ~500 KB per poll. The narrow
    // select below cuts the response ~5x. The WHERE joins through
    // Bracket.divisionId (FK index) → Division.tournamentId (FK
    // index) which the planner handles as 2 nested-loop lookups.
    prisma.match.findMany({
      where: { bracket: { division: { tournamentId } } },
      select: {
        id: true,
        matchNumber: true,
        status: true,
        ringNumber: true,
        bracket: { select: { id: true, divisionId: true } },
      },
    }),
  ]);

  // Check-in counts
  const checkedIn = registrations.filter((r) => r.checkedIn);
  const notCheckedIn = registrations.filter((r) => !r.checkedIn);

  // Weight mismatches: registration weight at check-in differs from initial by > 2 lbs
  // (kids grow; >2 lb difference is a re-weigh signal)
  const weightMismatches = checkedIn
    .filter((r) => r.checkInWeight != null && r.weightAtRegistration != null
      && Math.abs(r.checkInWeight - r.weightAtRegistration) > 2)
    .map((r) => ({
      registrationId: r.id,
      name: `${r.competitor.firstName} ${r.competitor.lastName}`,
      school: r.competitor.schoolDojang,
      weightAtRegistration: r.weightAtRegistration,
      checkInWeight: r.checkInWeight,
      delta: r.checkInWeight! - r.weightAtRegistration!,
    }));

  // Match status counts
  const matchCounts = {
    total: matches.length,
    pending: matches.filter((m) => m.status === 'pending').length,
    ready: matches.filter((m) => m.status === 'ready').length,
    inProgress: matches.filter((m) => m.status === 'in_progress').length,
    completed: matches.filter((m) => m.status === 'completed').length,
  };

  // By ring: how many matches are scheduled per ring, how many in-progress
  // Matches with null ringNumber are NOT bucketed into a default ring (the
  // previous `|| 1` fallback miscounted unassigned matches into Ring 1 and
  // made "Up next by ring" lie about which ring was busy). Closes #30
  // (the public scoreboard fix shipped in fa278b6 applied the same logic
  // on the client; this is the server side).
  const byRing: Record<number, { total: number; inProgress: number; completed: number }> = {};
  for (const m of matches) {
    if (m.ringNumber == null) continue;
    const ring = m.ringNumber;
    if (!byRing[ring]) byRing[ring] = { total: 0, inProgress: 0, completed: 0 };
    byRing[ring].total++;
    if (m.status === 'in_progress') byRing[ring].inProgress++;
    else if (m.status === 'completed') byRing[ring].completed++;
  }

  // Backfill from configured ring count (tournament.settings.rings.count).
  // Without this, a brand-new tournament with no matches routed to a ring
  // yet shows an empty byRing / upNext list even though rings 1..N are
  // configured in the Schedule page. Same fix as the DirectorDashboard
  // backfill in 320bac8.
  let configuredRingCount = 0;
  try {
    const settings = tournament.settings ? JSON.parse(tournament.settings) : null;
    configuredRingCount = settings?.rings?.count || 0;
  } catch {
    configuredRingCount = 0;
  }
  for (let i = 1; i <= configuredRingCount; i++) {
    if (!byRing[i]) byRing[i] = { total: 0, inProgress: 0, completed: 0 };
  }

  // Up next per ring: next ready match (smallest matchNumber per ring)
  const upNext: Array<{ ring: number; matchId: string; matchNumber: number; division: string }> = [];
  for (const ring of Object.keys(byRing).map(Number)) {
    const nextMatch = matches
      .filter((m) => m.ringNumber === ring && m.status === 'ready')
      .sort((a, b) => a.matchNumber - b.matchNumber)[0];
    if (nextMatch) {
      const div = divisions.find((d) => d.id === nextMatch.bracket.divisionId);
      upNext.push({
        ring,
        matchId: nextMatch.id,
        matchNumber: nextMatch.matchNumber,
        division: div?.name || 'Unknown',
      });
    }
  }

  return res.json({
    tournament: { id: tournament.id, name: tournament.name, date: tournament.date, status: tournament.status },
    checkIn: {
      total: registrations.length,
      checkedIn: checkedIn.length,
      notCheckedIn: notCheckedIn.length,
      percent: registrations.length > 0 ? Math.round((checkedIn.length / registrations.length) * 100) : 0,
      weightMismatches: weightMismatches.length,
      weightMismatchDetails: weightMismatches.slice(0, 10),
    },
    matches: matchCounts,
    byRing,
    upNext,
    divisionCount: divisions.length,
  });
});

// Reassign a division's matches to a different ring. Used by the schedule
// editor to move a fight that's running long onto a less-busy ring, or
// to consolidate when one ring falls behind. Closes the ring-reassignment
// gap from the abandoned code-review branch.
router.put(
  '/:id/schedule/reassign',
  authenticate,
  requireTournamentAccess('director'),
  validateRequest(ringReassignSchema),
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = req.params.id;
    const { divisionId, ring } = req.body;

    // Look up the bracket scoped to this tournament AND to a non
    // soft-deleted tournament — a director who knows a bracketId
    // that belonged to a soft-deleted tournament should not be
    // able to reassign its matches.
    const bracket = await prisma.bracket.findFirst({
      where: {
        divisionId,
        division: { tournamentId, tournament: { deletedAt: null } },
      },
    });

    if (!bracket) {
      return res.status(404).json({ error: 'No bracket found for this division' });
    }

    await prisma.match.updateMany({
      where: { bracketId: bracket.id },
      data: { ringNumber: ring },
    });

    res.json({ success: true, divisionId, ring });
  }
);

// Validation schema for branding updates
const brandingUpdateSchema = z.object({
  brandName: z.string().min(1).max(200).nullable().optional(),
  brandPrimaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color code').nullable().optional(),
  brandLogoUrl: z.string().url('Must be a valid URL').max(500).nullable().optional(),
});

// Get tournament branding
router.get('/:id/branding', authenticate, requireTournamentAccess('viewer'), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  
  const tournament = await prisma.tournament.findUnique({
    where: { id: getParam(req.params.id) },
    select: {
      id: true,
      name: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      deletedAt: true,
      organizationId: true,
      organization: {
        select: {
          brandName: true,
          brandPrimaryColor: true,
          brandLogoUrl: true,
        },
      },
    },
  });

  if (!tournament || tournament.deletedAt) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  // Return tournament branding with org fallback
  const branding = {
    brandName: tournament.brandName || tournament.organization?.brandName || tournament.name,
    brandPrimaryColor: tournament.brandPrimaryColor || tournament.organization?.brandPrimaryColor || '#DC2626',
    brandLogoUrl: tournament.brandLogoUrl || tournament.organization?.brandLogoUrl || null,
    hasOrgBranding: !!tournament.organizationId && !tournament.brandName,
  };

  res.json(branding);
});

// Update tournament branding (directors only)
router.put(
  '/:id/branding',
  authenticate,
  requireTournamentAccess('director'),
  validateRequest(brandingUpdateSchema),
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { brandName, brandPrimaryColor, brandLogoUrl } = req.body;

    const updated = await prisma.tournament.update({
      where: { id: getParam(req.params.id) },
      data: {
        brandName: brandName !== undefined ? brandName : undefined,
        brandPrimaryColor: brandPrimaryColor !== undefined ? brandPrimaryColor : undefined,
        brandLogoUrl: brandLogoUrl !== undefined ? brandLogoUrl : undefined,
      },
      select: {
        id: true,
        name: true,
        brandName: true,
        brandPrimaryColor: true,
        brandLogoUrl: true,
      },
    });

    res.json(updated);
  }
);

// Schedule delay propagation (P1-125: Day-of delay recording)
router.post(
  '/:id/schedule/delay/preview',
  authenticate,
  requireTournamentAccess('director'),
  validateRequest(
    z.object({
      delayType: z.enum(['ring', 'division']),
      ringNumber: z.number().int().min(1).optional(),
      divisionId: z.string().uuid().optional(),
      delayMinutes: z.number().int().min(1).max(480), // Max 8 hours
      reason: z.string().min(1).max(500),
    })
  ),
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.id);
    const delayInput = req.body as {
      delayType: 'ring' | 'division';
      ringNumber?: number;
      divisionId?: string;
      delayMinutes: number;
      reason: string;
    };

    const { previewScheduleDelay } = await import('../services/schedule-delay-propagation.js');

    try {
      const preview = await previewScheduleDelay(prisma, {
        tournamentId,
        ...delayInput,
      });
      res.json(preview);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to preview schedule delay' });
      }
    }
  }
);

router.post(
  '/:id/schedule/delay/apply',
  authenticate,
  requireTournamentAccess('director'),
  validateRequest(
    z.object({
      delayInput: z.object({
        delayType: z.enum(['ring', 'division']),
        ringNumber: z.number().int().min(1).optional(),
        divisionId: z.string().uuid().optional(),
        delayMinutes: z.number().int().min(1).max(480),
        reason: z.string().min(1).max(500),
      }),
      expectedUpdatedAt: z.string(),
      expectedInputVersion: z.string(),
      operationKey: z.string(),
    })
  ),
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.id);
    const authReq = req as AuthenticatedRequest;
    const { applyScheduleDelay } = await import('../services/schedule-delay-propagation.js');

    try {
      const result = await applyScheduleDelay(prisma, {
        tournamentId,
        delayInput: req.body.delayInput,
        expectedUpdatedAt: req.body.expectedUpdatedAt,
        expectedInputVersion: req.body.expectedInputVersion,
        operationKey: req.body.operationKey,
        approvedBy: authReq.user!.id,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes('stale') ||
          error.message.includes('changed since preview')
        ) {
          res.status(409).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: 'Failed to apply schedule delay' });
      }
    }
  }
);

router.post(
  '/:id/schedule/delay/undo/:auditId',
  authenticate,
  requireTournamentAccess('director'),
  async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const authReq = req as AuthenticatedRequest;
    const { undoScheduleDelay } = await import('../services/schedule-delay-propagation.js');

    try {
      await undoScheduleDelay(
        prisma,
        getParam(req.params.auditId),
        authReq.user!.id,
        new Date(),
        getParam(req.params.id)
      );
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to undo schedule delay' });
      }
    }
  }
);

export default router;

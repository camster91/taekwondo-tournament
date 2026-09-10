/**
 * Public portal routes for tenant-branded event discovery.
 * No authentication required — organizers share these URLs with competitors/parents.
 * 
 * Routing:
 *   GET  /api/public/portal/:orgSlug              - List org's published events
 *   GET  /api/public/portal/:orgSlug/:eventSlug   - Event portal landing (register, schedule, results)
 */

import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limit portal routes to prevent enumeration attacks and scraping
const portalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production',
});

/**
 * GET /api/public/portal/:orgSlug
 * 
 * List published events for an organization.
 * Returns only portalPublished=true && status='registration' events.
 * Fail-closed: wrong org slug returns empty list, not 404 (prevents enumeration).
 */
router.get('/:orgSlug', portalLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgSlug } = req.params;

  // Validate orgSlug format
  if (!orgSlug || !/^[a-z0-9-]{3,63}$/.test(orgSlug)) {
    // Fail closed: wrong format gets empty list, not an error that leaks existence
    return res.json({ organization: null, events: [] });
  }

  // Find organization by slug
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
    },
  });

  if (!organization) {
    // Fail closed: wrong org slug gets empty list, not 404
    return res.json({ organization: null, events: [] });
  }

  // Fetch published events for this org
  const events = await prisma.tournament.findMany({
    where: {
      organizationId: organization.id,
      portalPublished: true,
      deletedAt: null,
      date: {
        gte: new Date(), // Only future/current events
      },
    },
    select: {
      id: true,
      name: true,
      eventSlug: true,
      date: true,
      location: true,
      status: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      sportProfileSlug: true,
      _count: {
        select: { registrations: true },
      },
    },
    orderBy: { date: 'asc' },
  });

  res.json({
    organization: {
      name: organization.brandName || organization.name,
      slug: organization.slug,
      brandPrimaryColor: organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: organization.brandLogoUrl || null,
    },
    events: events.map((e) => ({
      id: e.id,
      slug: e.eventSlug,
      name: e.name,
      date: e.date,
      location: e.location,
      status: e.status,
      registrationCount: e._count.registrations,
      // Event-level branding overrides org branding
      brandName: e.brandName || organization.brandName || e.name,
      brandPrimaryColor: e.brandPrimaryColor || organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: e.brandLogoUrl || organization.brandLogoUrl || null,
    })),
  });
});

/**
 * GET /api/public/portal/:orgSlug/:eventSlug
 * 
 * Event portal landing page data.
 * Returns event details + org context for branded display.
 * Fail-closed: wrong slug returns 404 (indistinguishable from "not found").
 */
router.get('/:orgSlug/:eventSlug', portalLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgSlug, eventSlug } = req.params;

  // Validate slug formats
  if (!orgSlug || !/^[a-z0-9-]{3,63}$/.test(orgSlug)) {
    return res.status(404).json({ error: 'Event not found' });
  }
  if (!eventSlug || !/^[a-z0-9-]{3,63}$/.test(eventSlug)) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Find organization + event in one query
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
      tournaments: {
        where: {
          eventSlug,
          portalPublished: true,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          eventSlug: true,
          date: true,
          location: true,
          status: true,
          brandName: true,
          brandPrimaryColor: true,
          brandLogoUrl: true,
          sportProfileSlug: true,
          portalPublishedAt: true,
          publicSlug: true, // For scoreboard link
          settings: true,    // For registration fee parsing
          _count: {
            select: { registrations: true },
          },
        },
        take: 1,
      },
    },
  });

  if (!organization || organization.tournaments.length === 0) {
    // Fail closed: wrong slug returns 404, same shape as "not found"
    return res.status(404).json({ error: 'Event not found' });
  }

  const event = organization.tournaments[0];

  // Parse registration fee from settings (same logic as public.ts)
  let registrationFee: string | null = null;
  try {
    if (event.settings) {
      const parsed = JSON.parse(event.settings) as Record<string, unknown>;
      const fee = parsed.registrationFee;
      if (typeof fee === 'string' && fee.trim()) {
        registrationFee = fee;
      }
    }
  } catch {
    // Ignore parse errors
  }

  res.json({
    organization: {
      name: organization.brandName || organization.name,
      slug: organization.slug,
      brandPrimaryColor: organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: organization.brandLogoUrl || null,
    },
    event: {
      id: event.id,
      slug: event.eventSlug,
      name: event.name,
      date: event.date,
      location: event.location,
      status: event.status,
      registrationCount: event._count.registrations,
      registrationFee,
      publicScoreboardSlug: event.publicSlug, // For linking to scoreboard
      // Event-level branding overrides org branding
      brandName: event.brandName || organization.brandName || event.name,
      brandPrimaryColor: event.brandPrimaryColor || organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: event.brandLogoUrl || organization.brandLogoUrl || null,
      portalUrl: `/events/${orgSlug}/${eventSlug}`,
      registerUrl: `/register/${event.id}`,
      scoreboardUrl: event.publicSlug ? `/scoreboard/${event.publicSlug}` : null,
    },
  });
});

export default router;

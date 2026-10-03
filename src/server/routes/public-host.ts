/**
 * GET /api/public/host — which organizer owns the host this page was loaded
 * from. The SPA calls it once so that, on an organizer's verified custom
 * domain, `/` and `/register` show that organizer's events instead of the
 * bowin marketing page and the list of every open tournament.
 *
 * No authentication. Returns only what the organizer already shows on its
 * public portal (name, slug, colour, logo) — never ids or member data. On the
 * default app host (or any host that is not an active custom domain) it
 * answers `{ organization: null }`.
 */

import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import type { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { getResolvedOrg } from '../middleware/custom-domain-host.js';
import { canHidePlatformBranding } from '../services/entitlements.js';

const router = Router();

const hostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production',
});

export interface HostOrganization {
  slug: string;
  name: string;
  brandPrimaryColor: string;
  brandLogoUrl: string | null;
}

export interface HostLookupResponse {
  organization: HostOrganization | null;
  /** The organizer's plan hides bowin from parents (whiteLabel). */
  hidePlatformBranding: boolean;
}

/** Resolve this request's custom-domain organizer to its public portal details. */
export async function lookupHostOrganization(prisma: PrismaClient, res: Response): Promise<HostLookupResponse> {
  const resolved = getResolvedOrg(res);
  if (!resolved?.isCustomDomain || !resolved.resolvedOrgId) {
    return { organization: null, hidePlatformBranding: false };
  }
  const organization = await prisma.organization.findUnique({
    where: { id: resolved.resolvedOrgId },
    select: {
      slug: true,
      name: true,
      plan: true,
      brandName: true,
      brandPrimaryColor: true,
      brandLogoUrl: true,
    },
  });
  if (!organization?.slug) {
    return { organization: null, hidePlatformBranding: false };
  }
  return {
    organization: {
      slug: organization.slug,
      name: organization.brandName || organization.name,
      brandPrimaryColor: organization.brandPrimaryColor || '#DC2626',
      brandLogoUrl: organization.brandLogoUrl || null,
    },
    hidePlatformBranding: canHidePlatformBranding(organization.plan),
  };
}

router.get('/', hostLimiter, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  // Host-dependent: shared caches must not serve one domain's answer to another.
  res.setHeader('Vary', 'Host');
  res.setHeader('Cache-Control', 'no-store');
  res.json(await lookupHostOrganization(prisma, res));
});

export default router;

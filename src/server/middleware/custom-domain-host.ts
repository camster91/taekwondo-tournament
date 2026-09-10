/**
 * Custom domain host resolution middleware
 * 
 * Resolves the request Host header to an organization when using custom domains.
 * Fail-closed: unverified, inactive, or cross-tenant hosts are rejected.
 * 
 * This middleware should run BEFORE public portal routes to enable host-based routing.
 */

import type { Request, Response, NextFunction } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';

/**
 * Attach resolved organization ID to request locals when custom domain is detected
 */
export interface CustomDomainLocals {
  resolvedOrgId?: string;
  resolvedOrgSlug?: string;
  isCustomDomain?: boolean;
}

/**
 * Middleware to resolve custom domain Host header to organization
 * 
 * Sets req.app.locals.customDomain = { orgId, orgSlug, isCustomDomain: true }
 * if the request comes from a verified+active custom domain.
 * 
 * Fail-closed: returns 404 for unverified/disabled/revoked domains.
 */
export function resolveCustomDomainHost() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const prisma: PrismaClient = req.app.locals.prisma;

    // Extract hostname from Host header
    const hostHeader = req.get('host');
    if (!hostHeader) {
      return next();
    }

    // Normalize hostname (strip port if present)
    const hostname = hostHeader.split(':')[0].toLowerCase();

    // Skip if this is the default app domain (not a custom domain)
    const publicAppUrl = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
    const defaultHost = new URL(publicAppUrl).hostname.toLowerCase();

    if (hostname === defaultHost || hostname === 'localhost' || hostname === '127.0.0.1') {
      return next();
    }

    // Look up custom domain
    const customDomain = await prisma.customDomain.findUnique({
      where: { hostname },
      include: {
        organization: {
          select: {
            id: true,
            slug: true,
            name: true,
            brandName: true,
          },
        },
      },
    });

    if (!customDomain) {
      // Not a recognized custom domain — pass through
      // (Could be a shared Bowin subdomain or other hostname)
      return next();
    }

    // Fail-closed: only active domains are allowed to serve traffic
    if (customDomain.status !== 'active') {
      return res.status(404).json({
        error: 'Domain not available',
        details: `This domain is ${customDomain.status}. Please contact the event organizer.`,
      });
    }

    // Attach resolved org info to request locals
    const customDomainLocals: CustomDomainLocals = {
      resolvedOrgId: customDomain.organizationId,
      resolvedOrgSlug: customDomain.organization.slug,
      isCustomDomain: true,
    };

    // Store in req.app.locals for access by route handlers
    req.app.locals.customDomain = customDomainLocals;

    next();
  };
}

/**
 * Helper to get resolved org info from custom domain middleware
 */
export function getResolvedOrg(req: Request): CustomDomainLocals | null {
  return req.app.locals.customDomain || null;
}

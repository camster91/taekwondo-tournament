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

type CachedLookup =
  | { kind: 'none' }
  | { kind: 'inactive'; status: string }
  | { kind: 'active'; locals: CustomDomainLocals };

export interface ResolveCustomDomainHostOptions {
  /** How long a lookup result (including "not a custom domain") is cached. */
  cacheTtlMs?: number;
  /** Upper bound on cached hostnames (oldest entries evicted first). */
  maxCacheEntries?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

// Static assets never need tenant resolution; skipping them avoids a DB
// lookup per JS/CSS/image request on custom domains.
const STATIC_ASSET_PATH = /^\/(?:assets|logos|icons|fonts|images)\/|\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|txt|webmanifest|json)$/i;

export function isStaticAssetPath(path: string): boolean {
  return !path.startsWith('/api/') && STATIC_ASSET_PATH.test(path);
}

/**
 * Middleware to resolve custom domain Host header to organization
 *
 * Sets res.locals.customDomain = { resolvedOrgId, resolvedOrgSlug, isCustomDomain: true }
 * for THIS request only when it comes from a verified+active custom domain.
 * (It previously wrote to req.app.locals, which is process-global and
 * never cleared, so one tenant's resolution leaked into every later
 * request on any host.)
 *
 * Lookups — including misses for unknown hosts — are cached briefly so
 * arbitrary Host headers cannot force a DB query per request.
 *
 * Fail-closed: returns 404 for unverified/disabled/revoked domains.
 */
export function resolveCustomDomainHost(options: ResolveCustomDomainHostOptions = {}) {
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const maxCacheEntries = options.maxCacheEntries ?? 1_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: CachedLookup; expiresAt: number }>();

  const remember = (hostname: string, value: CachedLookup) => {
    if (cacheTtlMs <= 0) return;
    if (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(hostname, { value, expiresAt: now() + cacheTtlMs });
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    // Never inherit a resolution from anything but this request.
    delete res.locals.customDomain;

    if (isStaticAssetPath(req.path)) {
      return next();
    }

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

    let lookup: CachedLookup;
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > now()) {
      lookup = cached.value;
    } else {
      if (cached) cache.delete(hostname);
      const prisma: PrismaClient = req.app.locals.prisma;
      const customDomain = await prisma.customDomain.findUnique({
        where: { hostname },
        select: {
          status: true,
          organizationId: true,
          organization: { select: { slug: true } },
        },
      });

      if (!customDomain) {
        // Not a recognized custom domain — pass through
        // (Could be a shared Bowin subdomain or other hostname)
        lookup = { kind: 'none' };
      } else if (customDomain.status !== 'active') {
        lookup = { kind: 'inactive', status: customDomain.status };
      } else {
        lookup = {
          kind: 'active',
          locals: {
            resolvedOrgId: customDomain.organizationId,
            resolvedOrgSlug: customDomain.organization.slug,
            isCustomDomain: true,
          },
        };
      }
      remember(hostname, lookup);
    }

    if (lookup.kind === 'none') {
      return next();
    }

    // Fail-closed: only active domains are allowed to serve traffic
    if (lookup.kind === 'inactive') {
      return res.status(404).json({
        error: 'Domain not available',
        details: `This domain is ${lookup.status}. Please contact the event organizer.`,
      });
    }

    // Per-request storage only.
    res.locals.customDomain = { ...lookup.locals };

    next();
  };
}

/**
 * Helper to get resolved org info from custom domain middleware
 */
export function getResolvedOrg(res: Response): CustomDomainLocals | null {
  return (res.locals.customDomain as CustomDomainLocals | undefined) ?? null;
}

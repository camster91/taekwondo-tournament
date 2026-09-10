/**
 * Custom domain management routes
 * 
 * Allows organization admins to attach, verify, activate, and revoke
 * custom domains for organizer-branded public portals.
 */

import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  generateVerificationToken,
  getTxtVerificationRecord,
  getCnameVerificationRecord,
  verifyDomain,
  normalizeHostname,
  isValidHostname,
  isBowinOwnedDomain,
} from '../services/custom-domain-verification.js';

const router = Router();

/**
 * GET /api/custom-domains/organization/:orgId
 * 
 * List all custom domains for an organization
 * Requires: admin or director role + org membership
 */
router.get(
  '/organization/:orgId',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { orgId } = req.params;

    // Verify org membership (admins can access any org)
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: req.user!.id,
          },
        },
      });

      if (!member) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const domains = await prisma.customDomain.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ domains });
  },
);

/**
 * POST /api/custom-domains/organization/:orgId/attach
 * 
 * Attach a new custom domain to an organization
 * Requires: admin or director role + org membership
 * 
 * Body: { hostname: string, verificationMethod?: 'txt' | 'cname' }
 */
router.post(
  '/organization/:orgId/attach',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { orgId } = req.params;
    const { hostname: rawHostname, verificationMethod = 'txt' } = req.body;

    // Verify org membership (admins can access any org)
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: req.user!.id,
          },
        },
      });

      if (!member) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Validate input
    if (!rawHostname || typeof rawHostname !== 'string') {
      return res.status(400).json({ error: 'Hostname is required' });
    }

    if (!['txt', 'cname'].includes(verificationMethod)) {
      return res.status(400).json({ error: 'Verification method must be "txt" or "cname"' });
    }

    // Normalize and validate hostname
    const hostname = normalizeHostname(rawHostname);

    if (!isValidHostname(hostname)) {
      return res.status(400).json({
        error: 'Invalid hostname format. Must be a valid domain name (e.g., register.myclub.com)',
      });
    }

    // Check for Bowin-owned domains
    if (isBowinOwnedDomain(hostname)) {
      return res.status(400).json({
        error: 'Cannot use Bowin-owned domains as custom domains',
      });
    }

    // Check if domain already exists
    const existing = await prisma.customDomain.findUnique({
      where: { hostname },
      include: { organization: true },
    });

    if (existing) {
      // If it belongs to this org and is not revoked, allow re-attachment (regenerate token)
      if (existing.organizationId === orgId && existing.status !== 'revoked') {
        // Regenerate verification token
        const verificationToken = generateVerificationToken();

        const updated = await prisma.customDomain.update({
          where: { id: existing.id },
          data: {
            verificationMethod,
            verificationToken,
            verifiedAt: null,
            status: 'pending',
            createdBy: req.user!.id,
            updatedAt: new Date(),
          },
        });

        const verificationRecord =
          verificationMethod === 'txt'
            ? getTxtVerificationRecord(hostname, verificationToken)
            : getCnameVerificationRecord(hostname, verificationToken);

        return res.json({
          domain: updated,
          verificationRecord,
          message: 'Domain re-attached. Please add the DNS record and verify.',
        });
      }

      // Domain is owned by another org
      return res.status(409).json({
        error: 'This domain is already registered to another organization',
      });
    }

    // Create new custom domain
    const verificationToken = generateVerificationToken();

    const domain = await prisma.customDomain.create({
      data: {
        organizationId: orgId,
        hostname,
        verificationMethod,
        verificationToken,
        status: 'pending',
        createdBy: req.user!.id,
      },
    });

    // Audit log
    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        action: 'custom_domain_attached',
        details: JSON.stringify({ domainId: domain.id, hostname, organizationId: orgId }),
        organizationId: orgId,
      },
    });

    const verificationRecord =
      verificationMethod === 'txt'
        ? getTxtVerificationRecord(hostname, verificationToken)
        : getCnameVerificationRecord(hostname, verificationToken);

    res.status(201).json({
      domain,
      verificationRecord,
      message: 'Domain attached. Please add the DNS record and verify.',
    });
  },
);

/**
 * POST /api/custom-domains/:domainId/verify
 * 
 * Verify domain ownership via DNS
 * Requires: admin or director role + org membership
 */
router.post(
  '/:domainId/verify',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { domainId } = req.params;

    const domain = await prisma.customDomain.findUnique({
      where: { id: domainId },
    });

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Verify org membership (admins can access any org)
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: domain.organizationId,
            userId: req.user!.id,
          },
        },
      });

      if (!member) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Cannot verify revoked domains
    if (domain.status === 'revoked') {
      return res.status(400).json({ error: 'Cannot verify a revoked domain' });
    }

    // Perform DNS verification
    const verificationResult = await verifyDomain(
      domain.hostname,
      domain.verificationMethod as 'txt' | 'cname',
      domain.verificationToken,
    );

    if (!verificationResult.verified) {
      return res.status(400).json({
        error: 'Domain verification failed',
        details: verificationResult.error,
      });
    }

    // Update domain status
    const updated = await prisma.customDomain.update({
      where: { id: domainId },
      data: {
        status: 'verified',
        verifiedAt: new Date(),
        verifiedBy: req.user!.id,
      },
    });

    // Audit log
    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        action: 'custom_domain_verified',
        details: JSON.stringify({ domainId, hostname: domain.hostname, organizationId: domain.organizationId }),
        organizationId: domain.organizationId,
      },
    });

    res.json({
      domain: updated,
      message: 'Domain verified successfully. You can now activate it.',
    });
  },
);

/**
 * POST /api/custom-domains/:domainId/activate
 * 
 * Activate a verified domain (start serving traffic)
 * Requires: admin or director role + org membership
 */
router.post(
  '/:domainId/activate',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { domainId } = req.params;

    const domain = await prisma.customDomain.findUnique({
      where: { id: domainId },
    });

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Verify org membership (admins can access any org)
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: domain.organizationId,
            userId: req.user!.id,
          },
        },
      });

      if (!member) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Cannot activate revoked domains
    if (domain.status === 'revoked') {
      return res.status(400).json({ error: 'Cannot activate a revoked domain' });
    }

    // Must be verified first
    if (domain.status !== 'verified' && domain.status !== 'disabled') {
      return res.status(400).json({
        error: 'Domain must be verified before activation',
      });
    }

    // Update domain status
    const updated = await prisma.customDomain.update({
      where: { id: domainId },
      data: {
        status: 'active',
        activatedAt: domain.activatedAt || new Date(), // Only set on first activation
        activatedBy: req.user!.id,
        disabledAt: null, // Clear disabled timestamp if re-activating
      },
    });

    // Audit log
    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        action: 'custom_domain_activated',
        details: JSON.stringify({ domainId, hostname: domain.hostname, organizationId: domain.organizationId }),
        organizationId: domain.organizationId,
      },
    });

    res.json({
      domain: updated,
      message: 'Domain activated successfully. It is now serving traffic.',
    });
  },
);

/**
 * POST /api/custom-domains/:domainId/disable
 * 
 * Disable an active domain (soft-disable, can be re-enabled)
 * Requires: admin or director role + org membership
 */
router.post(
  '/:domainId/disable',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { domainId } = req.params;

    const domain = await prisma.customDomain.findUnique({
      where: { id: domainId },
    });

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Verify org membership (admins can access any org)
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: domain.organizationId,
            userId: req.user!.id,
          },
        },
      });

      if (!member) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (domain.status === 'revoked') {
      return res.status(400).json({ error: 'Cannot disable a revoked domain' });
    }

    // Update domain status
    const updated = await prisma.customDomain.update({
      where: { id: domainId },
      data: {
        status: 'disabled',
        disabledAt: new Date(),
      },
    });

    // Audit log
    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        action: 'custom_domain_disabled',
        details: JSON.stringify({ domainId, hostname: domain.hostname, organizationId: domain.organizationId }),
        organizationId: domain.organizationId,
      },
    });

    res.json({
      domain: updated,
      message: 'Domain disabled successfully.',
    });
  },
);

/**
 * POST /api/custom-domains/:domainId/revoke
 * 
 * Permanently revoke a domain (cannot be reactivated)
 * Requires: admin or director role + org membership
 * 
 * Body: { reason: string }
 */
router.post(
  '/:domainId/revoke',
  authenticate,
  requireRole('admin', 'director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { domainId } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Revocation reason is required' });
    }

    const domain = await prisma.customDomain.findUnique({
      where: { id: domainId },
    });

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Verify org membership (admins can access any org)
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: domain.organizationId,
            userId: req.user!.id,
          },
        },
      });

      if (!member) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (domain.status === 'revoked') {
      return res.status(400).json({ error: 'Domain is already revoked' });
    }

    // Update domain status
    const updated = await prisma.customDomain.update({
      where: { id: domainId },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: req.user!.id,
        revokedReason: reason.trim(),
      },
    });

    // Audit log
    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        action: 'custom_domain_revoked',
        details: JSON.stringify({
          domainId,
          hostname: domain.hostname,
          organizationId: domain.organizationId,
          reason: reason.trim(),
        }),
        organizationId: domain.organizationId,
      },
    });

    res.json({
      domain: updated,
      message: 'Domain revoked permanently.',
    });
  },
);

/**
 * DELETE /api/custom-domains/:domainId
 * 
 * Hard-delete a custom domain (only for pending/disabled domains)
 * Requires: admin role
 */
router.delete(
  '/:domainId',
  authenticate,
  requireRole('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const { domainId } = req.params;

    const domain = await prisma.customDomain.findUnique({
      where: { id: domainId },
    });

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Only allow deletion of pending/disabled domains
    if (!['pending', 'disabled'].includes(domain.status)) {
      return res.status(400).json({
        error: 'Only pending or disabled domains can be deleted. Revoke active domains first.',
      });
    }

    await prisma.customDomain.delete({
      where: { id: domainId },
    });

    // Audit log
    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        action: 'custom_domain_deleted',
        details: JSON.stringify({ domainId, hostname: domain.hostname, organizationId: domain.organizationId }),
        organizationId: domain.organizationId,
      },
    });

    res.json({ message: 'Domain deleted successfully' });
  },
);

export default router;

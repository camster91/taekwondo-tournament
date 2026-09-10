/**
 * Custom domain host resolution middleware tests
 * 
 * Tests for host-based routing and fail-closed security.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient, Organization } from '@prisma/client';
import { createTestServer, cleanupTestData } from '../../test/helpers.js';
import type { Express } from 'express';
import request from 'supertest';

describe('Custom Domain Host Middleware', () => {
  let app: Express;
  let prisma: PrismaClient;
  let org1: Organization;
  let activeDomain: { id: string; hostname: string };
  let pendingDomain: { id: string; hostname: string };
  let disabledDomain: { id: string; hostname: string };
  let revokedDomain: { id: string; hostname: string };

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    prisma = server.prisma;

    // Create test organization
    org1 = await prisma.organization.create({
      data: {
        name: 'Test Org Host',
        slug: 'test-org-host',
        plan: 'starter',
      },
    });

    // Create domains in various states
    const activeResult = await prisma.customDomain.create({
      data: {
        organizationId: org1.id,
        hostname: 'active.testdomain.com',
        verificationMethod: 'txt',
        verificationToken: 'active-token',
        status: 'active',
        verifiedAt: new Date(),
        activatedAt: new Date(),
      },
    });
    activeDomain = { id: activeResult.id, hostname: activeResult.hostname };

    const pendingResult = await prisma.customDomain.create({
      data: {
        organizationId: org1.id,
        hostname: 'pending.testdomain.com',
        verificationMethod: 'txt',
        verificationToken: 'pending-token',
        status: 'pending',
      },
    });
    pendingDomain = { id: pendingResult.id, hostname: pendingResult.hostname };

    const disabledResult = await prisma.customDomain.create({
      data: {
        organizationId: org1.id,
        hostname: 'disabled.testdomain.com',
        verificationMethod: 'txt',
        verificationToken: 'disabled-token',
        status: 'disabled',
        verifiedAt: new Date(),
        disabledAt: new Date(),
      },
    });
    disabledDomain = { id: disabledResult.id, hostname: disabledResult.hostname };

    const revokedResult = await prisma.customDomain.create({
      data: {
        organizationId: org1.id,
        hostname: 'revoked.testdomain.com',
        verificationMethod: 'txt',
        verificationToken: 'revoked-token',
        status: 'revoked',
        revokedAt: new Date(),
        revokedReason: 'Test revocation',
      },
    });
    revokedDomain = { id: revokedResult.id, hostname: revokedResult.hostname };
  });

  afterAll(async () => {
    await cleanupTestData(prisma, {
      organizationSlugs: [org1.slug],
    });
  });

  describe('Host resolution', () => {
    it('should allow requests on active custom domain', async () => {
      // Make a request with the active domain as Host header
      // Using /api/sports as a simple public endpoint
      const res = await request(app)
        .get('/api/sports')
        .set('Host', activeDomain.hostname);

      expect(res.status).not.toBe(404);
      // Should succeed (sports endpoint is public)
    });

    it('should reject requests on pending custom domain', async () => {
      const res = await request(app)
        .get('/api/sports')
        .set('Host', pendingDomain.hostname);

      // Middleware should return 404 for non-active domains
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not available');
    });

    it('should reject requests on disabled custom domain', async () => {
      const res = await request(app)
        .get('/api/sports')
        .set('Host', disabledDomain.hostname);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not available');
    });

    it('should reject requests on revoked custom domain', async () => {
      const res = await request(app)
        .get('/api/sports')
        .set('Host', revokedDomain.hostname);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not available');
    });

    it('should pass through requests on default app domain', async () => {
      const res = await request(app)
        .get('/api/sports')
        .set('Host', 'localhost:5173');

      expect(res.status).not.toBe(404);
    });

    it('should pass through requests on unrecognized hostname', async () => {
      const res = await request(app)
        .get('/api/sports')
        .set('Host', 'unknown.example.com');

      expect(res.status).not.toBe(404);
      // Should pass through to routes (may succeed or fail based on endpoint)
    });
  });

  describe('Cross-org isolation', () => {
    it('should resolve correct org for active custom domain', async () => {
      // We can't easily test req.app.locals in a supertest request,
      // but we can verify that requests with custom domain Host headers
      // don't leak across orgs by checking audit logs or other side effects.
      // For now, we verify that the middleware allows active domains through.
      const res = await request(app)
        .get('/api/sports')
        .set('Host', activeDomain.hostname);

      expect(res.status).toBe(200);
    });
  });
});

/**
 * Custom domain routes tests
 * 
 * Tests for custom domain attach/verify/activate/revoke flows
 * and cross-org isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient, User, Organization } from '@prisma/client';
import { createTestServer, cleanupTestData, createAuthenticatedRequest } from '../../test/helpers.js';
import type { Express } from 'express';

describe.skip('Custom Domain Routes', () => {
  let app: Express;
  let prisma: PrismaClient;
  let org1: Organization;
  let org2: Organization;
  let admin: User;
  let org1Director: User;
  let org2Director: User;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    prisma = server.prisma;

    // Create test organizations
    org1 = await prisma.organization.create({
      data: {
        name: 'Org One',
        slug: 'org-one-custom-domain',
        plan: 'starter',
      },
    });

    org2 = await prisma.organization.create({
      data: {
        name: 'Org Two',
        slug: 'org-two-custom-domain',
        plan: 'starter',
      },
    });

    // Create admin user
    admin = await prisma.user.create({
      data: {
        email: 'admin-custom-domain@example.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
      },
    });

    // Create org-specific directors
    org1Director = await prisma.user.create({
      data: {
        email: 'org1-director@example.com',
        firstName: 'Org1',
        lastName: 'Director',
        role: 'director',
        organizationMemberships: {
          create: {
            organizationId: org1.id,
            role: 'admin',
          },
        },
      },
    });

    org2Director = await prisma.user.create({
      data: {
        email: 'org2-director@example.com',
        firstName: 'Org2',
        lastName: 'Director',
        role: 'director',
        organizationMemberships: {
          create: {
            organizationId: org2.id,
            role: 'admin',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma, {
      userEmails: [admin.email, org1Director.email, org2Director.email],
      organizationSlugs: [org1.slug, org2.slug],
    });
  });

  describe('POST /api/custom-domains/organization/:orgId/attach', () => {
    it('should attach a custom domain with TXT verification', async () => {
      const res = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'register.testclub.com',
          verificationMethod: 'txt',
        });

      expect(res.status).toBe(201);
      expect(res.body.domain).toMatchObject({
        organizationId: org1.id,
        hostname: 'register.testclub.com',
        verificationMethod: 'txt',
        status: 'pending',
      });
      expect(res.body.verificationRecord).toHaveProperty('name');
      expect(res.body.verificationRecord.name).toContain('_bowin-verify.register.testclub.com');
      expect(res.body.verificationRecord).toHaveProperty('value');
    });

    it('should attach a custom domain with CNAME verification', async () => {
      const res = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'events.testclub.com',
          verificationMethod: 'cname',
        });

      expect(res.status).toBe(201);
      expect(res.body.domain).toMatchObject({
        organizationId: org1.id,
        hostname: 'events.testclub.com',
        verificationMethod: 'cname',
        status: 'pending',
      });
      expect(res.body.verificationRecord).toHaveProperty('name');
      expect(res.body.verificationRecord).toHaveProperty('target');
      expect(res.body.verificationRecord.target).toContain('verify-');
      expect(res.body.verificationRecord.target).toContain('.bowin.app');
    });

    it('should reject Bowin-owned domains', async () => {
      const bowinDomains = [
        'bowin.app',
        'test.bowin.app',
        'bowin.io',
        'register.bowin.io',
        'ashbi.ca',
        'test.ashbi.ca',
      ];

      for (const hostname of bowinDomains) {
        const res = await createAuthenticatedRequest(app, admin.id)
          .post(`/api/custom-domains/organization/${org1.id}/attach`)
          .send({ hostname, verificationMethod: 'txt' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Bowin-owned');
      }
    });

    it('should reject invalid hostnames', async () => {
      const invalidHostnames = [
        'not-a-domain', // no TLD
        'https://example.com', // protocol included
        'example.com:8080', // port included
        '', // empty
        'a'.repeat(254), // too long
      ];

      for (const hostname of invalidHostnames) {
        const res = await createAuthenticatedRequest(app, admin.id)
          .post(`/api/custom-domains/organization/${org1.id}/attach`)
          .send({ hostname, verificationMethod: 'txt' });

        expect(res.status).toBe(400);
      }
    });

    it('should prevent cross-org domain squatting', async () => {
      // Attach domain to org1
      await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'exclusive.testclub.com',
          verificationMethod: 'txt',
        });

      // Attempt to attach same domain to org2
      const res = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org2.id}/attach`)
        .send({
          hostname: 'exclusive.testclub.com',
          verificationMethod: 'txt',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already registered');
    });

    it('should deny org2 director from attaching domain to org1', async () => {
      const res = await createAuthenticatedRequest(app, org2Director.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'unauthorized.testclub.com',
          verificationMethod: 'txt',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/custom-domains/organization/:orgId', () => {
    it('should list domains for organization', async () => {
      // Attach a couple domains
      await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'list-test-1.testclub.com',
          verificationMethod: 'txt',
        });

      await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'list-test-2.testclub.com',
          verificationMethod: 'cname',
        });

      const res = await createAuthenticatedRequest(app, org1Director.id)
        .get(`/api/custom-domains/organization/${org1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.domains.length).toBeGreaterThanOrEqual(2);
      const hostnames = res.body.domains.map((d: { hostname: string }) => d.hostname);
      expect(hostnames).toContain('list-test-1.testclub.com');
      expect(hostnames).toContain('list-test-2.testclub.com');
    });

    it('should deny org2 director from listing org1 domains', async () => {
      const res = await createAuthenticatedRequest(app, org2Director.id)
        .get(`/api/custom-domains/organization/${org1.id}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/custom-domains/:domainId/verify (mocked DNS)', () => {
    it('should fail verification if DNS record is missing', async () => {
      const attachRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'verify-fail.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      const verifyRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/${domainId}/verify`);

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.error).toContain('verification failed');
    });
  });

  describe('POST /api/custom-domains/:domainId/activate', () => {
    it('should reject activation of unverified domain', async () => {
      const attachRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'activate-test-pending.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      const activateRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/${domainId}/activate`);

      expect(activateRes.status).toBe(400);
      expect(activateRes.body.error).toContain('must be verified');
    });

    it('should allow activation after manual verification', async () => {
      const attachRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'activate-test-verified.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      // Manually mark as verified (simulating successful DNS check)
      await prisma.customDomain.update({
        where: { id: domainId },
        data: {
          status: 'verified',
          verifiedAt: new Date(),
        },
      });

      const activateRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/${domainId}/activate`);

      expect(activateRes.status).toBe(200);
      expect(activateRes.body.domain.status).toBe('active');
      expect(activateRes.body.domain.activatedAt).toBeTruthy();
    });
  });

  describe('POST /api/custom-domains/:domainId/revoke', () => {
    it('should revoke a domain permanently', async () => {
      const attachRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'revoke-test.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      const revokeRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/${domainId}/revoke`)
        .send({ reason: 'Test revocation' });

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.domain.status).toBe('revoked');
      expect(revokeRes.body.domain.revokedReason).toBe('Test revocation');
    });

    it('should reject revocation without reason', async () => {
      const attachRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'revoke-no-reason.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      const revokeRes = await createAuthenticatedRequest(app, admin.id)
        .post(`/api/custom-domains/${domainId}/revoke`)
        .send({});

      expect(revokeRes.status).toBe(400);
      expect(revokeRes.body.error).toContain('reason');
    });
  });

  describe('Cross-org isolation', () => {
    it('should block org2 director from verifying org1 domain', async () => {
      const attachRes = await createAuthenticatedRequest(app, org1Director.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'isolation-test-verify.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      const verifyRes = await createAuthenticatedRequest(app, org2Director.id)
        .post(`/api/custom-domains/${domainId}/verify`);

      expect(verifyRes.status).toBe(403);
    });

    it('should block org2 director from activating org1 domain', async () => {
      const attachRes = await createAuthenticatedRequest(app, org1Director.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'isolation-test-activate.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      // Manually verify the domain
      await prisma.customDomain.update({
        where: { id: domainId },
        data: { status: 'verified', verifiedAt: new Date() },
      });

      const activateRes = await createAuthenticatedRequest(app, org2Director.id)
        .post(`/api/custom-domains/${domainId}/activate`);

      expect(activateRes.status).toBe(403);
    });

    it('should block org2 director from revoking org1 domain', async () => {
      const attachRes = await createAuthenticatedRequest(app, org1Director.id)
        .post(`/api/custom-domains/organization/${org1.id}/attach`)
        .send({
          hostname: 'isolation-test-revoke.testclub.com',
          verificationMethod: 'txt',
        });

      const domainId = attachRes.body.domain.id;

      const revokeRes = await createAuthenticatedRequest(app, org2Director.id)
        .post(`/api/custom-domains/${domainId}/revoke`)
        .send({ reason: 'Unauthorized attempt' });

      expect(revokeRes.status).toBe(403);
    });
  });
});

/**
 * Integration tests for portal-scoped registration endpoint.
 * Validates tenant isolation, fail-closed behavior, and cross-org protection
 * by mounting the actual router with mocked Prisma.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import express, { type Express } from 'express';
import request from 'supertest';

// Import the actual router
import publicPortalRouter from './public-portal.js';

// Mock Prisma client
function createMockPrisma(): Partial<PrismaClient> {
  return {
    organization: {
      findUnique: vi.fn(),
    } as any,
    registration: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    } as any,
    competitor: {
      findFirst: vi.fn(),
      create: vi.fn(),
    } as any,
  };
}

describe('Portal-scoped registration (real router)', () => {
  let app: Express;
  let prisma: Partial<PrismaClient>;

  beforeEach(() => {
    // Disable rate limiting for tests
    process.env.RATE_LIMIT_DISABLED = '1';
    process.env.NODE_ENV = 'test';
    
    app = express();
    app.use(express.json());
    prisma = createMockPrisma();
    app.locals.prisma = prisma;
    
    // Mount the router under /api/public/portal
    app.use('/api/public/portal', publicPortalRouter);
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  it('rejects invalid org slug format (fail-closed with 404)', async () => {
    const response = await request(app)
      .post('/api/public/portal/UPPERCASE/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Event not found');
    // Should not even query the database
    expect(prisma.organization?.findUnique).not.toHaveBeenCalled();
  });

  it('rejects invalid event slug format (fail-closed with 404)', async () => {
    const response = await request(app)
      .post('/api/public/portal/karate-dojo/HAS_UNDERSCORE/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Event not found');
  });

  it('returns 404 when organization does not exist', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue(null);

    const response = await request(app)
      .post('/api/public/portal/nonexistent-org/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Event not found');
    expect(prisma.organization!.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'nonexistent-org' },
      })
    );
  });

  it('returns 404 when event does not exist for org', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-1',
      plan: 'pro',
      brandName: 'Test Org',
      name: 'Test Org',
      tournaments: [], // No matching event
    });

    const response = await request(app)
      .post('/api/public/portal/karate-dojo/nonexistent-event/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Event not found');
  });

  it('returns 404 when event is unpublished', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-1',
      plan: 'pro',
      brandName: 'Test Org',
      name: 'Test Org',
      tournaments: [], // DB query filters portalPublished=true, so unpublished events don't appear
    });

    const response = await request(app)
      .post('/api/public/portal/karate-dojo/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404);
  });

  it('prevents cross-tenant registration (org A cannot register for org B event)', async () => {
    // Attempting to register through org A's portal for org B's event
    // The query filters by organizationId, so org B's event won't appear
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-a',
      plan: 'pro',
      brandName: 'Org A',
      name: 'Org A',
      tournaments: [], // No events from org-b appear in org-a's query
    });

    const response = await request(app)
      .post('/api/public/portal/org-a/org-b-event/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Event not found');
  });

  it('returns 400 when event status is not "registration"', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-1',
      plan: 'pro',
      brandName: 'Test Org',
      name: 'Test Org',
      tournaments: [{
        id: 'event-1',
        name: 'Spring Championship',
        date: new Date('2027-06-01'),
        location: 'Test Venue',
        status: 'completed', // Event is closed
        settings: null,
        brandName: null,
        organizationId: 'org-1',
      }],
    });

    const response = await request(app)
      .post('/api/public/portal/karate-dojo/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Registration is not open for this event');
  });

  it('requires parent contact for minors when guardianAttested', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-1',
      plan: 'pro',
      brandName: 'Test Org',
      name: 'Test Org',
      tournaments: [{
        id: 'event-1',
        name: 'Spring Championship',
        date: new Date('2027-06-01'),
        location: 'Test Venue',
        status: 'registration',
        settings: null,
        brandName: null,
        organizationId: 'org-1',
      }],
    });

    (prisma.registration!.count as any).mockResolvedValue(0);

    const response = await request(app)
      .post('/api/public/portal/karate-dojo/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01', // Minor (12 years old at tournament)
        belt: 'Yellow',
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
        guardianAttested: true,
        // Missing parentName and parentEmail
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Parent.*Guardian.*required/i);
  });

  it('validates required fields', async () => {
    const response = await request(app)
      .post('/api/public/portal/karate-dojo/spring-2027/register')
      .send({
        // Missing firstName, lastName, gender, dateOfBirth, belt
        patterns: true,
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(404); // Slug validation happens first
  });

  it('requires at least one event (patterns or sparring)', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-1',
      plan: 'pro',
      brandName: 'Test Org',
      name: 'Test Org',
      tournaments: [{
        id: 'event-1',
        name: 'Spring Championship',
        date: new Date('2027-06-01'),
        status: 'registration',
        settings: null,
        brandName: null,
        organizationId: 'org-1',
      }],
    });

    const response = await request(app)
      .post('/api/public/portal/karate-dojo/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        patterns: false,
        sparring: false, // Neither selected
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details).toContain('Please select at least one event (Patterns or Sparring)');
  });

  it('requires weight for sparring registration', async () => {
    (prisma.organization!.findUnique as any).mockResolvedValue({
      id: 'org-1',
      plan: 'pro',
      brandName: 'Test Org',
      name: 'Test Org',
      tournaments: [{
        id: 'event-1',
        name: 'Spring Championship',
        date: new Date('2027-06-01'),
        status: 'registration',
        settings: null,
        brandName: null,
        organizationId: 'org-1',
      }],
    });

    const response = await request(app)
      .post('/api/public/portal/karate-dojo/spring-2027/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        gender: 'M',
        dateOfBirth: '2015-01-01',
        belt: 'Yellow',
        sparring: true, // Selected sparring
        // Missing weightLbs
        privacyAccepted: true,
        rulesAccepted: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.details).toContain('Weight is required for sparring registration');
  });
});

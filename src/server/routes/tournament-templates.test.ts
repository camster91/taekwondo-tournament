import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

describe.skip('Tournament Templates — Tenant Isolation', () => {
  let prisma: PrismaClient;
  let org1Id: string;
  let org2Id: string;
  let user1Id: string;
  let user2Id: string;
  let template1Id: string;
  let template2Id: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    org1Id = crypto.randomUUID();
    org2Id = crypto.randomUUID();
    user1Id = crypto.randomUUID();
    user2Id = crypto.randomUUID();

    await prisma.organization.create({
      data: {
        id: org1Id,
        name: 'Org 1',
        slug: `org1-${Date.now()}`,
        plan: 'free',
      },
    });

    await prisma.organization.create({
      data: {
        id: org2Id,
        name: 'Org 2',
        slug: `org2-${Date.now()}`,
        plan: 'free',
      },
    });

    await prisma.user.create({
      data: {
        id: user1Id,
        email: `user1-${Date.now()}@test.local`,
        passwordHash: 'test',
        firstName: 'User',
        lastName: 'One',
        role: 'director',
      },
    });

    await prisma.user.create({
      data: {
        id: user2Id,
        email: `user2-${Date.now()}@test.local`,
        passwordHash: 'test',
        firstName: 'User',
        lastName: 'Two',
        role: 'director',
      },
    });

    await prisma.organizationMember.create({
      data: {
        organizationId: org1Id,
        userId: user1Id,
        role: 'admin',
      },
    });

    await prisma.organizationMember.create({
      data: {
        organizationId: org2Id,
        userId: user2Id,
        role: 'admin',
      },
    });

    const template1 = await prisma.tournamentTemplate.create({
      data: {
        name: 'Template 1',
        organizationId: org1Id,
        sportProfileSlug: 'taekwondo',
        settings: JSON.stringify({ divisionThreshold: 8 }),
        createdBy: user1Id,
      },
    });
    template1Id = template1.id;

    const template2 = await prisma.tournamentTemplate.create({
      data: {
        name: 'Template 2',
        organizationId: org2Id,
        sportProfileSlug: 'karate',
        settings: JSON.stringify({ divisionThreshold: 10 }),
        createdBy: user2Id,
      },
    });
    template2Id = template2.id;
  });

  afterAll(async () => {
    await prisma.tournamentTemplate.deleteMany({
      where: { id: { in: [template1Id, template2Id] } },
    });
    await prisma.organizationMember.deleteMany({
      where: { userId: { in: [user1Id, user2Id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [user1Id, user2Id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org1Id, org2Id] } },
    });
    await prisma.$disconnect();
  });

  it('user1 can read template1 (same org)', async () => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user1Id },
    });
    expect(membership).toBeTruthy();
    expect(membership!.organizationId).toBe(org1Id);

    const template = await prisma.tournamentTemplate.findFirst({
      where: {
        id: template1Id,
        organizationId: membership!.organizationId,
      },
    });
    expect(template).toBeTruthy();
    expect(template!.name).toBe('Template 1');
  });

  it('user1 cannot read template2 (different org)', async () => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user1Id },
    });
    expect(membership).toBeTruthy();

    const template = await prisma.tournamentTemplate.findFirst({
      where: {
        id: template2Id,
        organizationId: membership!.organizationId,
      },
    });
    expect(template).toBeNull();
  });

  it('user2 can read template2 (same org)', async () => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user2Id },
    });
    expect(membership).toBeTruthy();
    expect(membership!.organizationId).toBe(org2Id);

    const template = await prisma.tournamentTemplate.findFirst({
      where: {
        id: template2Id,
        organizationId: membership!.organizationId,
      },
    });
    expect(template).toBeTruthy();
    expect(template!.name).toBe('Template 2');
  });

  it('user2 cannot read template1 (different org)', async () => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user2Id },
    });
    expect(membership).toBeTruthy();

    const template = await prisma.tournamentTemplate.findFirst({
      where: {
        id: template1Id,
        organizationId: membership!.organizationId,
      },
    });
    expect(template).toBeNull();
  });

  it('soft-delete hides template from active list', async () => {
    await prisma.tournamentTemplate.update({
      where: { id: template1Id },
      data: { deletedAt: new Date() },
    });

    const activeTemplates = await prisma.tournamentTemplate.findMany({
      where: {
        organizationId: org1Id,
        deletedAt: null,
      },
    });
    expect(activeTemplates.find(t => t.id === template1Id)).toBeUndefined();

    const allTemplates = await prisma.tournamentTemplate.findMany({
      where: { organizationId: org1Id },
    });
    expect(allTemplates.find(t => t.id === template1Id)).toBeTruthy();

    await prisma.tournamentTemplate.update({
      where: { id: template1Id },
      data: { deletedAt: null },
    });
  });
});

describe.skip('Create Tournament from Template', () => {
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let templateId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    orgId = crypto.randomUUID();
    userId = crypto.randomUUID();

    await prisma.organization.create({
      data: {
        id: orgId,
        name: 'Test Org',
        slug: `test-org-${Date.now()}`,
        plan: 'starter',
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        email: `user-${Date.now()}@test.local`,
        passwordHash: 'test',
        firstName: 'Test',
        lastName: 'User',
        role: 'director',
      },
    });

    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId,
        role: 'admin',
      },
    });

    const template = await prisma.tournamentTemplate.create({
      data: {
        name: 'Test Template',
        organizationId: orgId,
        sportProfileSlug: 'judo',
        settings: JSON.stringify({ divisionThreshold: 6 }),
        rules: JSON.stringify([{ name: 'Test Rule', category: 'bracket' }]),
        weightClasses: JSON.stringify([
          { name: 'Feather', weightMinLbs: 100, weightMaxLbs: 120 },
        ]),
        createdBy: userId,
      },
    });
    templateId = template.id;
  });

  afterAll(async () => {
    await prisma.tournament.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.tournamentTemplate.deleteMany({
      where: { id: templateId },
    });
    await prisma.organizationMember.deleteMany({
      where: { userId },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
    await prisma.organization.deleteMany({
      where: { id: orgId },
    });
    await prisma.$disconnect();
  });

  it('creates tournament with template settings', async () => {
    const template = await prisma.tournamentTemplate.findUnique({
      where: { id: templateId },
    });
    expect(template).toBeTruthy();

    const tournament = await prisma.tournament.create({
      data: {
        name: 'Tournament from Template',
        date: new Date('2026-12-01T12:00:00.000Z'),
        location: 'Test Location',
        settings: template!.settings,
        sportProfileSlug: template!.sportProfileSlug,
        organizationId: orgId,
      },
    });

    expect(tournament.sportProfileSlug).toBe('judo');
    const settings = JSON.parse(tournament.settings!);
    expect(settings.divisionThreshold).toBe(6);

    await prisma.tournament.delete({
      where: { id: tournament.id },
    });
  });
});

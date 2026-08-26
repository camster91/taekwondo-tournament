import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEMO_MARKER, DEMO_ORGANIZATION_SLUG, assertSafeDemoDatabaseUrl, buildShowcaseFixture, resetDemoShowcase } from '../../../prisma/demo-seed.js';

const demoDatabaseUrl = process.env.DEMO_DATABASE_URL;
const integration = demoDatabaseUrl ? describe : describe.skip;
const sentinelOrgId = randomUUID();
const sentinelTournamentId = randomUUID();
const sentinelCompetitorId = randomUUID();
const rollbackSentinelTournamentId = randomUUID();
const sentinelOrgSlug = `demo-reset-sentinel-${randomUUID()}`;
const sentinelPublicSlug = `demo-reset-sentinel-public-${randomUUID()}`;
const fixture = buildShowcaseFixture();
let prisma: PrismaClient | undefined;

async function cleanExactDemoTestData(): Promise<void> {
  if (!prisma) return;
  await prisma.tournament.deleteMany({ where: { id: rollbackSentinelTournamentId, organizationId: sentinelOrgId } });
  const demo = await prisma.organization.findUnique({
    where: { slug: DEMO_ORGANIZATION_SLUG },
    select: { id: true, settings: true },
  });
  if (!demo) return;
  if (JSON.parse(demo.settings ?? '{}').marker !== DEMO_MARKER) {
    throw new Error('Refusing integration cleanup: canonical organization marker is not the demo marker');
  }
  const captured = await prisma.registration.findMany({
    where: { tournament: { organizationId: demo.id } },
    select: { competitorId: true },
    distinct: ['competitorId'],
  });
  await prisma.match.deleteMany({ where: { bracket: { division: { tournament: { organizationId: demo.id } } } } });
  await prisma.tournament.deleteMany({ where: { organizationId: demo.id } });
  await prisma.organization.delete({ where: { id: demo.id, settings: demo.settings } });
  await prisma.competitor.deleteMany({
    where: { id: { in: captured.map((row) => row.competitorId) }, registrations: { none: {} } },
  });
}

integration('demo showcase reset against disposable Postgres', () => {
  beforeAll(async () => {
    assertSafeDemoDatabaseUrl(demoDatabaseUrl!);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: demoDatabaseUrl! }) });
    await prisma.organization.create({ data: { id: sentinelOrgId, name: 'Non-demo sentinel', slug: sentinelOrgSlug, settings: JSON.stringify({ marker: 'not-demo' }) } });
    await prisma.tournament.create({ data: { id: sentinelTournamentId, organizationId: sentinelOrgId, name: 'Sentinel tournament', date: new Date('2030-01-01'), publicSlug: sentinelPublicSlug } });
    await prisma.competitor.create({ data: { id: sentinelCompetitorId, firstName: 'Sentinel', lastName: 'Competitor', gender: 'F', dateOfBirth: new Date('2000-01-01'), belt: 'Black' } });
  });

  beforeEach(async () => {
    await cleanExactDemoTestData();
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanExactDemoTestData();
    await prisma.tournament.deleteMany({ where: { id: sentinelTournamentId, organizationId: sentinelOrgId } });
    await prisma.organization.deleteMany({ where: { id: sentinelOrgId } });
    await prisma.competitor.deleteMany({ where: { id: sentinelCompetitorId, registrations: { none: {} } } });
    await prisma.competitor.deleteMany({ where: { id: { in: fixture.competitors.map((competitor) => competitor.id) }, registrations: { none: {} } } });
    await prisma.$disconnect();
  });

  it('is idempotent and preserves non-demo records and relational counts', async () => {
    await resetDemoShowcase(prisma!);
    await resetDemoShowcase(prisma!);

    const demoOrganizations = await prisma!.organization.findMany({ where: { slug: DEMO_ORGANIZATION_SLUG }, include: { tournaments: { include: { registrations: true, divisions: { include: { bracket: { include: { matches: true } } } } } } } });
    expect(demoOrganizations).toHaveLength(1);
    expect(demoOrganizations[0].tournaments).toHaveLength(fixture.tournaments.length);
    expect(demoOrganizations[0].tournaments.flatMap((tournament) => tournament.registrations)).toHaveLength(fixture.registrations.length);
    expect(demoOrganizations[0].tournaments.flatMap((tournament) => tournament.divisions)).toHaveLength(fixture.divisions.length);
    expect(demoOrganizations[0].tournaments.flatMap((tournament) => tournament.divisions.flatMap((division) => division.bracket?.matches ?? []))).toHaveLength(fixture.matches.length);
    expect(new Set(demoOrganizations[0].tournaments.map((tournament) => tournament.publicSlug)).size).toBe(2);
    expect(await prisma!.competitor.count({ where: { id: { in: fixture.competitors.map((competitor) => competitor.id) } } })).toBe(fixture.competitors.length);
    expect(await prisma!.organization.count({ where: { id: sentinelOrgId } })).toBe(1);
    expect(await prisma!.tournament.count({ where: { id: sentinelTournamentId } })).toBe(1);
    expect(await prisma!.competitor.count({ where: { id: sentinelCompetitorId } })).toBe(1);
  });

  it('rolls back deletion of the existing demo when fixture insertion fails', async () => {
    await resetDemoShowcase(prisma!);
    const live = fixture.tournaments.find((tournament) => tournament.status === 'in_progress')!;
    await prisma!.tournament.update({ where: { id: live.id }, data: { publicSlug: `${live.publicSlug}-before-rollback` } });
    await prisma!.tournament.create({ data: { id: rollbackSentinelTournamentId, organizationId: sentinelOrgId, name: 'Slug collision sentinel', date: new Date('2030-02-01'), publicSlug: live.publicSlug } });

    await expect(resetDemoShowcase(prisma!)).rejects.toMatchObject({ code: 'P2002' });

    expect(await prisma!.organization.count({ where: { slug: DEMO_ORGANIZATION_SLUG } })).toBe(1);
    expect(await prisma!.tournament.count({ where: { organizationId: fixture.organization.id } })).toBe(fixture.tournaments.length);
    expect(await prisma!.registration.count({ where: { tournament: { organizationId: fixture.organization.id } } })).toBe(fixture.registrations.length);
    expect((await prisma!.tournament.findUnique({ where: { id: live.id } }))?.publicSlug).toBe(`${live.publicSlug}-before-rollback`);
  });

  it('refuses a canonical organization whose marker changed and preserves its records', async () => {
    await resetDemoShowcase(prisma!);
    await prisma!.organization.update({ where: { id: fixture.organization.id }, data: { settings: JSON.stringify({ marker: 'not-demo' }) } });
    try {
      await expect(resetDemoShowcase(prisma!)).rejects.toThrow(/refusing/i);
      expect(await prisma!.organization.count({ where: { id: fixture.organization.id } })).toBe(1);
      expect(await prisma!.tournament.count({ where: { organizationId: fixture.organization.id } })).toBe(fixture.tournaments.length);
      expect(await prisma!.registration.count({ where: { tournament: { organizationId: fixture.organization.id } } })).toBe(fixture.registrations.length);
    } finally {
      await prisma!.organization.update({ where: { id: fixture.organization.id }, data: { settings: fixture.organization.settings } });
    }
  });
});

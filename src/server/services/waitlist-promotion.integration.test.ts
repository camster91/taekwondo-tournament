import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { promoteWaitlistedRegistration } from './waitlist.js';

const databaseUrl = process.env.WAITLIST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
let prisma: PrismaClient;

integration('promoteWaitlistedRegistration against disposable Postgres', () => {
  const token = (label: string) => ({ managementTokenHash: `${label}-${randomUUID()}`, managementTokenExpiresAt: new Date('2031-01-01') });

  const waitlisted = async (position: number) => {
    const competitor = await prisma.competitor.create({ data: {
      organizationId, firstName: `Wait${position}`, lastName: 'Listed', gender: 'F', dateOfBirth: new Date('2012-01-01'), belt: 'Blue',
    } });
    return prisma.registration.create({ data: { tournamentId, competitorId: competitor.id, waitlistStatus: 'waitlisted', waitlistPosition: position } });
  };

  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('WAITLIST_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Waitlist', slug: `waitlist-${organizationId}` } });
    await prisma.tournament.create({ data: {
      id: tournamentId, organizationId, name: '[E2E] Waitlist Open', date: new Date('2030-01-01'), maxCapacity: 1, waitlistEnabled: true,
    } });
  });

  beforeEach(async () => {
    await prisma.registration.deleteMany({ where: { tournamentId } });
    await prisma.competitor.deleteMany({ where: { organizationId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.competitor.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('concurrent promotes of different registrations cannot overfill the tournament', async () => {
    const [a, b] = [await waitlisted(1), await waitlisted(2)];
    const results = await Promise.all([
      promoteWaitlistedRegistration(prisma, tournamentId, a.id, token('a')),
      promoteWaitlistedRegistration(prisma, tournamentId, b.id, token('b')),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ status: 400, code: 'TOURNAMENT_FULL' });
    expect(await prisma.registration.count({ where: { tournamentId, waitlistStatus: 'promoted' } })).toBe(1);
    // The one still waiting is renumbered to position 1.
    expect(await prisma.registration.findFirst({ where: { tournamentId, waitlistStatus: 'waitlisted' } })).toMatchObject({ waitlistPosition: 1 });
  });

  it('a double promote succeeds once; the second gets 409 and does not rotate the token', async () => {
    const reg = await waitlisted(1);
    const first = token('first');
    const second = token('second');
    const results = await Promise.all([
      promoteWaitlistedRegistration(prisma, tournamentId, reg.id, first),
      promoteWaitlistedRegistration(prisma, tournamentId, reg.id, second),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ status: 409, code: 'NOT_WAITLISTED' });
    const stored = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } });
    const winner = results[0].ok ? first : second;
    expect(stored).toMatchObject({ waitlistStatus: 'promoted', managementTokenHash: winner.managementTokenHash });
  });

  it('rejects a registration from another tournament as not found', async () => {
    const reg = await waitlisted(1);
    expect(await promoteWaitlistedRegistration(prisma, randomUUID(), reg.id, token('x'))).toMatchObject({ status: 404 });
  });
});

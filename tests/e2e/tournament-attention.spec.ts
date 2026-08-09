import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, loginRequestAsEmail, skipOnboardingTour } from './helpers';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const operatorEmail = 'attention-operator-e2e@example.com';
const ids = {
  organization: '00000000-0000-4000-8000-00000000a701',
  otherOrganization: '00000000-0000-4000-8000-00000000a702',
  tournament: '00000000-0000-4000-8000-00000000a703',
  otherTournament: '00000000-0000-4000-8000-00000000a704',
  division: '00000000-0000-4000-8000-00000000a705',
  competitors: ['00000000-0000-4000-8000-00000000a706', '00000000-0000-4000-8000-00000000a707'],
};
let operatorId = '';

test.beforeAll(async () => {
  const operator = await prisma.user.upsert({
    where: { email: operatorEmail },
    update: { role: 'director', isActive: true },
    create: { email: operatorEmail, firstName: 'Attention', lastName: 'Operator', role: 'director', isActive: true },
  });
  operatorId = operator.id;
  await prisma.tournament.deleteMany({ where: { id: { in: [ids.tournament, ids.otherTournament] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.organization, ids.otherOrganization] } } });
  await prisma.competitor.deleteMany({ where: { id: { in: ids.competitors } } });
  await prisma.organization.createMany({ data: [
    { id: ids.organization, name: '[E2E] Attention Org', slug: 'e2e-attention-org' },
    { id: ids.otherOrganization, name: '[E2E] Other Org', slug: 'e2e-attention-other-org' },
  ] });
  await prisma.organizationMember.create({ data: { organizationId: ids.organization, userId: operator.id, role: 'member' } });
  await prisma.competitor.createMany({ data: ids.competitors.map((id, index) => ({
    id, firstName: `Attention ${index + 1}`, lastName: 'Athlete', gender: index ? 'F' : 'M',
    dateOfBirth: new Date('2010-01-01T00:00:00.000Z'), belt: 'Blue', schoolDojang: 'E2E Dojang',
  })) });
  await prisma.tournament.create({
    data: {
      id: ids.tournament, organizationId: ids.organization, name: '[E2E] Attention Tournament',
      date: new Date('2027-08-09T14:00:00.000Z'), status: 'in_progress', publicSlug: 'e2e-attention-public',
      registrations: { create: ids.competitors.map((competitorId) => ({ competitorId, patterns: true })) },
    },
  });
  const registrations = await prisma.registration.findMany({ where: { tournamentId: ids.tournament }, orderBy: { competitorId: 'asc' } });
  await prisma.division.create({
    data: {
      id: ids.division, tournamentId: ids.tournament, name: 'E2E Patterns Division', beltLevel: 'CB', gender: 'M',
      eventType: 'patterns', ageMin: 10, ageMax: 18,
      assignments: { create: registrations.map((registration) => ({ registrationId: registration.id })) },
    },
  });
  await prisma.tournament.create({
    data: { id: ids.otherTournament, organizationId: ids.otherOrganization, name: '[E2E] Other Tournament', date: new Date('2027-08-10'), status: 'in_progress' },
  });
});

test.afterAll(async () => {
  await prisma.tournament.deleteMany({ where: { id: { in: [ids.tournament, ids.otherTournament] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.organization, ids.otherOrganization] } } });
  await prisma.competitor.deleteMany({ where: { id: { in: ids.competitors } } });
  await prisma.user.deleteMany({ where: { email: operatorEmail } });
  await prisma.$disconnect();
});

test('attention and heartbeat endpoints enforce access and persist only tournament freshness', async ({ request }) => {
  const anonymous = await request.get(`/api/tournaments/${ids.tournament}/attention`);
  expect(anonymous.status()).toBe(401);

  const invalidHeartbeat = await request.post(`/api/public/tournaments/${ids.tournament}/display-heartbeat?key=wrong`);
  expect(invalidHeartbeat.status()).toBe(404);
  const heartbeat = await request.post(`/api/public/tournaments/${ids.tournament}/display-heartbeat?key=e2e-attention-public`);
  expect(heartbeat.status()).toBe(200);
  const stored = await prisma.publicDisplayHeartbeat.findUnique({ where: { tournamentId: ids.tournament } });
  expect(stored?.lastSeenAt).toBeInstanceOf(Date);

  const headers = await loginRequestAsEmail(request, operatorEmail);
  const authorized = await request.get(`/api/tournaments/${ids.tournament}/attention`, { headers });
  expect(authorized.status()).toBe(200);
  expect((await authorized.json()).alerts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'missing_bracket', affectedLabels: ['E2E Patterns Division'] }),
  ]));

  const crossTenant = await request.get(`/api/tournaments/${ids.otherTournament}/attention`, { headers });
  expect([403, 404]).toContain(crossTenant.status());

});

test('director sees actionable server and device-local alerts with recovery navigation', async ({ page }) => {
  await skipOnboardingTour(page);
  await page.addInitScript(({ ownerId, tournamentId }) => {
    localStorage.setItem('bowin_offline_operations_v1', JSON.stringify([{
      id: `${ownerId}:check_in:e2e-registration`, revision: 'e2e-review', kind: 'check_in', ownerId,
      tournamentId, targetId: 'e2e-registration', createdAt: new Date().toISOString(), payload: { checkedIn: true },
      status: 'needs_review', lastError: 'E2E server conflict',
    }]));
  }, { ownerId: operatorId, tournamentId: ids.tournament });
  await loginAsEmail(page, operatorEmail);
  await page.goto(`/tournaments/${ids.tournament}/director`);

  await expect(page.getByRole('heading', { name: 'Attention required' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Divisions need brackets' })).toBeVisible();
  await expect(page.getByText(/Affected: E2E Patterns Division/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offline changes need review' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Check-in review' })).toHaveAttribute('href', `/checkin/${ids.tournament}`);
  await expect(page.getByRole('link', { name: 'Score review' })).toHaveAttribute('href', `/scorekeeper/${ids.tournament}`);
});

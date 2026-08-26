import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

test('director reviews, approves, confirms, and applies a deterministic division recommendation', async ({ page }) => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const organizationId = randomUUID();
  const tournamentId = randomUUID();
  const completeCompetitorId = randomUUID();
  const incompleteCompetitorId = randomUUID();
  const email = `division-recommendation-${randomUUID()}@example.test`;

  try {
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Division Recommendation', slug: `division-recommendation-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Division Recommendation', date: new Date('2030-03-01') } });
    await prisma.user.create({ data: { email, firstName: 'Division', lastName: 'Director', role: 'admin' } });
    await prisma.competitor.createMany({ data: [
      { id: completeCompetitorId, firstName: 'Amina', lastName: 'Rahman', gender: 'F', dateOfBirth: new Date('2020-01-01'), belt: 'Yellow', schoolDojang: 'North Star' },
      { id: incompleteCompetitorId, firstName: 'Needs', lastName: 'Age Review', gender: 'F', dateOfBirth: new Date('2020-01-01'), belt: 'Yellow', schoolDojang: 'East Gate' },
    ] });
    await prisma.registration.createMany({ data: [
      { tournamentId, competitorId: completeCompetitorId, patterns: true, ageAtTournament: 10 },
      { tournamentId, competitorId: incompleteCompetitorId, patterns: true, ageAtTournament: null },
    ] });

    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}/divisions`);
    await expect(page.getByRole('heading', { name: 'Division recommendation assistant' })).toBeVisible();

    await page.getByRole('button', { name: 'Generate recommendation' }).click();
    await expect(page.getByText('Recommendation ready for director review. No divisions changed.')).toBeVisible();
    await expect(page.getByText('Amina Rahman — North Star')).toBeVisible();
    await expect(page.getByText('Needs Age Review: missing tournament age', { exact: true })).toBeVisible();
    await expect(page.getByText(/Input completeness: 50%/)).toBeVisible();
    await expect(page.getByText(/Deterministic means reproducible, not automatically correct/)).toBeVisible();

    await page.getByRole('button', { name: 'Approve recommendation' }).click();
    await expect(page.getByText('Recommendation approved. Divisions have not changed; Apply is still required.')).toBeVisible();
    expect(await prisma.division.count({ where: { tournamentId } })).toBe(0);

    await page.getByRole('button', { name: 'Apply approved recommendation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Apply approved division recommendation?' });
    await expect(dialog).toContainText('1 incomplete registrations remain unassigned');
    await expect(dialog).toContainText('this audit does not promise a permanent undo');
    await dialog.getByRole('button', { name: 'Apply recommendation' }).click();
    await expect(page.getByText(/Approved recommendation applied/)).toBeVisible();

    expect(await prisma.division.count({ where: { tournamentId } })).toBe(1);
    expect(await prisma.divisionAssignment.count({ where: { division: { tournamentId } } })).toBe(1);
    await expect(prisma.recommendation.findFirst({ where: { tournamentId } })).resolves.toMatchObject({
      status: 'applied', approvedBy: expect.any(String), appliedBy: expect.any(String),
    });
  } finally {
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.competitor.deleteMany({ where: { id: { in: [completeCompetitorId, incompleteCompetitorId] }, registrations: { none: {} } } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});

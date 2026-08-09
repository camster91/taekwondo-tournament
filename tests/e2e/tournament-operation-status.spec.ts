import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const email = 'tournament-operations-e2e@example.com';
const testTournamentId = '00000000-0000-4000-8000-00000000e201';
const testCompetitorIds = [
  '00000000-0000-4000-8000-00000000e211',
  '00000000-0000-4000-8000-00000000e212',
  '00000000-0000-4000-8000-00000000e213',
];
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
let tournamentId = testTournamentId;

test.beforeAll(async () => {
  await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', isActive: true },
    create: { email, firstName: 'Tournament', lastName: 'Operator', role: 'admin', isActive: true },
  });
  await prisma.tournament.deleteMany({ where: { id: testTournamentId } });
  await prisma.competitor.deleteMany({ where: { id: { in: testCompetitorIds } } });
  await prisma.competitor.createMany({
    data: testCompetitorIds.map((id, index) => ({
      id,
      firstName: `E2E-${index + 1}`,
      lastName: 'Tournament Operator',
      gender: index % 2 === 0 ? 'M' : 'F',
      dateOfBirth: new Date(`201${index}-01-01T00:00:00.000Z`),
      belt: 'Blue',
      weightLbs: 100 + index,
      schoolDojang: 'E2E Isolated Dojang',
    })),
  });
  await prisma.tournament.create({
    data: {
      id: testTournamentId,
      name: '[E2E] Tournament Operations',
      date: new Date('2027-10-10T13:00:00.000Z'),
      location: 'E2E Isolated Venue',
      status: 'in_progress',
      registrations: {
        create: testCompetitorIds.slice(0, 2).map((competitorId, index) => ({
          competitorId,
          patterns: index === 0,
          sparring: index === 1,
          ageAtTournament: 15 + index,
        })),
      },
    },
  });
});

test.afterAll(async () => {
  await prisma.tournament.deleteMany({ where: { id: testTournamentId } });
  await prisma.competitor.deleteMany({ where: { id: { in: testCompetitorIds } } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test('registration changes serialize and rejected actions remain visible', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}`);

  const patterns = page.getByRole('button', { name: /Patterns (enrolled|not enrolled)/ }).first();
  const sparring = page.getByRole('button', { name: /Sparring (enrolled|not enrolled)/ }).first();
  const remove = page.getByRole('button', { name: /^Remove .* from this tournament$/ }).first();
  const originallyPressed = await patterns.getAttribute('aria-pressed');

  let updateRequests = 0;
  await page.route('**/api/tournaments/*/registrations/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    updateRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Registration changed on another device' }),
    });
  });

  await patterns.click();
  await expect(sparring).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Registration changed on another device');
  await expect(patterns).toHaveAttribute('aria-pressed', originallyPressed ?? 'false');
  expect(updateRequests).toBe(1);

  await page.unroute('**/api/tournaments/*/registrations/*');
  await page.route('**/api/tournaments/*/registrations/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const registrationId = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const body = route.request().postDataJSON() as { patterns: boolean; sparring: boolean };
    await prisma.registration.update({ where: { id: registrationId }, data: body });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: registrationId, ...body }) });
  });
  await page.route(`**/api/tournaments/${tournamentId}/registrations`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.continue();
  });
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status')).toContainText('Saving');
  await expect(page.getByRole('status')).toContainText('the registration list is up to date');
  await expect(patterns).toHaveAttribute('aria-pressed', originallyPressed === 'true' ? 'false' : 'true');

  await page.unroute(`**/api/tournaments/${tournamentId}/registrations`);
  await page.unroute('**/api/tournaments/*/registrations/*');
  await remove.click();
  let removeRequests = 0;
  await page.route('**/api/tournaments/*/registrations/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    removeRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Registration is already assigned to a bracket' }),
    });
  });

  const removeDialog = page.getByRole('dialog', { name: 'Remove Registration' });
  await removeDialog.getByRole('button', { name: 'Remove' }).click();
  await page.keyboard.press('Escape');
  await expect(removeDialog).toBeVisible();
  await expect(removeDialog.getByRole('alert')).toContainText('Registration is already assigned to a bracket');
  await expect(page.getByRole('alert')).toHaveCount(1);
  expect(removeRequests).toBe(1);

  await page.unroute('**/api/tournaments/*/registrations/*');
  await page.route('**/api/tournaments/*/registrations/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const registrationId = new URL(route.request().url()).pathname.split('/').at(-1)!;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await prisma.registration.delete({ where: { id: registrationId } });
    return route.fulfill({ status: 204, body: '' });
  });
  await removeDialog.getByRole('button', { name: 'Remove' }).click();
  await expect(removeDialog).toBeVisible();
  await expect(removeDialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('was removed and the registration list is up to date');
});

test('lifecycle changes retain their exact operator intent through rejection and retry', async ({ page }) => {
  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: 'registration' } });
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}`);

  await page.route(`**/api/tournaments/${tournamentId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Tournament status changed on another device' }),
    });
  });

  await page.getByRole('button', { name: 'Close Registration' }).click();
  const closeDialog = page.getByRole('dialog', { name: 'Close Registration' });
  await closeDialog.getByRole('button', { name: 'Close Registration' }).click();
  await page.keyboard.press('Escape');
  await expect(closeDialog).toBeVisible();
  await expect(closeDialog.getByRole('alert')).toContainText('Tournament status changed on another device');
  await expect(page.getByRole('alert')).toHaveCount(1);

  await page.unroute(`**/api/tournaments/${tournamentId}`);
  await page.route(`**/api/tournaments/${tournamentId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const body = route.request().postDataJSON() as { status: string };
    await new Promise((resolve) => setTimeout(resolve, 300));
    const updated = await prisma.tournament.update({ where: { id: tournamentId }, data: { status: body.status } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
  });
  await closeDialog.getByRole('button', { name: 'Close Registration' }).click();
  await expect(closeDialog).toBeVisible();
  await expect(closeDialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Closing public registration completed');

  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: 'completed' } });
  await page.reload();
  await page.getByRole('button', { name: 'Reopen Tournament' }).click();
  await expect(page.getByRole('status')).toContainText('Reopening tournament');
  await expect(page.getByRole('status')).not.toContainText('Closing public registration');
  await expect(page.getByRole('status')).toContainText('Reopening tournament completed');

  await page.getByRole('button', { name: 'Add Competitors' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add Competitors' });
  await expect(addDialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  const competitorChoice = addDialog.locator('input[type="checkbox"]').nth(2);
  await competitorChoice.check();
  const addSelected = addDialog.getByRole('button', { name: /Add 1 Competitor/ });
  await addSelected.focus();
  await page.keyboard.press('Tab');
  await expect(addDialog.getByRole('button', { name: 'Close' })).toBeFocused();
  let bulkAttempts = 0;
  let selectedBulkIds: string[] = [];
  await page.route(`**/api/tournaments/${tournamentId}/registrations/bulk`, async (route) => {
    bulkAttempts += 1;
    selectedBulkIds = (route.request().postDataJSON() as { competitorIds: string[] }).competitorIds;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Registration service is temporarily unavailable' }),
    });
  });
  await addSelected.click();
  await expect(addDialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(addDialog.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(addDialog).toBeVisible();
  await expect(addDialog.getByRole('alert')).toContainText('Registration service is temporarily unavailable');
  await expect(competitorChoice).toBeChecked();
  expect(bulkAttempts).toBe(1);

  await page.unroute(`**/api/tournaments/${tournamentId}/registrations/bulk`);
  await page.route(`**/api/tournaments/${tournamentId}/registrations/bulk`, async (route) => {
    const body = route.request().postDataJSON() as { competitorIds: string[]; patterns: boolean; sparring: boolean };
    await new Promise((resolve) => setTimeout(resolve, 300));
    await prisma.registration.createMany({
      data: body.competitorIds.map((competitorId) => ({
        tournamentId,
        competitorId,
        patterns: body.patterns,
        sparring: body.sparring,
      })),
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ created: body.competitorIds.length }),
    });
  });
  await addSelected.click();
  await expect(addDialog).toBeVisible();
  await expect(addDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add Competitors' })).toBeFocused();
  await expect.poll(async () => prisma.registration.count({
    where: { tournamentId, competitorId: { in: selectedBulkIds } },
  })).toBe(selectedBulkIds.length);
});

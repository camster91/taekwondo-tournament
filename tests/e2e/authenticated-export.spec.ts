import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const email = 'authenticated-export-e2e@example.com';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let tournamentId = '';

test.beforeAll(async () => {
  await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', isActive: true },
    create: { email, firstName: 'Export', lastName: 'Operator', role: 'admin', isActive: true },
  });
  const tournament = await prisma.tournament.findFirstOrThrow({ where: { name: 'Spring Championship 2026' } });
  tournamentId = tournament.id;
});

test.afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: 'e2e-authenticated-export' } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test('division bracket PDF locks rapid repeats and rejects an invalid file', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}/divisions`);

  let requests = 0;
  const endpoint = `**/api/brackets/tournament/${tournamentId}/pdf`;
  await page.route(endpoint, async (route) => {
    requests += 1;
    expect(route.request().headers().cookie).toContain('bowin_session=');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-brackets') });
  });
  const exportButton = page.getByRole('button', { name: 'Export PDFs' });
  const downloadPromise = page.waitForEvent('download');
  await exportButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.getByRole('status').filter({ hasText: 'Preparing all generated brackets' })).toBeVisible();
  expect((await downloadPromise).suggestedFilename()).toMatch(/_All_Brackets\.pdf$/);
  await expect(page.getByRole('status').filter({ hasText: 'download started' })).toBeVisible();
  expect(requests).toBe(1);

  await page.unroute(endpoint);
  await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: 'bad pdf' }));
  await exportButton.click();
  await expect(page.getByRole('alert')).toContainText('valid PDF');
});

test('organization JSON export locks rapid repeats and validates the downloaded data', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto('/organization');
  await page.getByLabel('Organization name').fill('E2E Authenticated Export');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Authenticated Export' })).toBeVisible();

  let requests = 0;
  await page.route('**/api/organizations/*/export', async (route) => {
    requests += 1;
    expect(route.request().headers().cookie).toContain('bowin_session=');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organization: 'E2E' }) });
  });
  const exportButton = page.getByRole('button', { name: 'Export organization data' });
  const downloadPromise = page.waitForEvent('download');
  await exportButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.getByRole('status')).toContainText('Preparing the complete organization data export');
  expect((await downloadPromise).suggestedFilename()).toBe('e2e-authenticated-export-export.json');
  await expect(page.getByRole('status')).toContainText('download started');
  expect(requests).toBe(1);

  await page.unroute('**/api/organizations/*/export');
  await page.route('**/api/organizations/*/export', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'bad json' }));
  await exportButton.click();
  await expect(page.getByRole('alert')).toContainText('valid JSON');
});

test('results PDF is single-flight, authenticated, validated, and reports only a started download', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, email);
  await page.goto(`/tournaments/${tournamentId}/results`);

  let requests = 0;
  await page.route(`**/api/brackets/tournament/${tournamentId}/results/pdf`, async (route) => {
    requests += 1;
    expect(route.request().headers().cookie).toContain('bowin_session=');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-test') });
  });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pdfButton = page.getByRole('button', { name: 'Results PDF' });
  await expect(pdfButton).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await pdfButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.getByRole('status')).toContainText('Preparing results PDF');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/_Results\.pdf$/);
  await expect(page.getByRole('status')).toContainText('Results PDF download started');
  expect(requests).toBe(1);

  await page.unroute(`**/api/brackets/tournament/${tournamentId}/results/pdf`);
  await page.route(`**/api/brackets/tournament/${tournamentId}/results/pdf`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: 'proxy error',
  }));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Results PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('valid PDF');
});

import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const email = 'organization-settings-e2e@example.com';

test.describe('organization settings', () => {
  test.beforeEach(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    try {
      await prisma.user.upsert({ where: { email }, update: { role: 'admin', isActive: true }, create: { email, firstName: 'Organization', lastName: 'Settings', role: 'admin', isActive: true } });
      await prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E' } } });
      // Every test signs in as this user; keep reruns under the per-email link cap.
      await prisma.magicLink.deleteMany({ where: { email } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('an operator can create a workspace and see plan usage and billing choices', async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/organization');

    await expect(page.getByRole('heading', { name: 'Organization & billing' })).toBeVisible();
    await expect(page.getByText('Set up your organization')).toBeVisible();
    await page.screenshot({ path: 'test-results/visual-qa/organization-empty-desktop.png', fullPage: true });

    const name = `E2E Billing Dojang ${Date.now()}`;
    await page.getByLabel('Organization name').fill(name);
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Free plan', { exact: true })).toBeVisible();
    await expect(page.getByText('Tournament usage')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Starter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Pro' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export organization data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete organization' })).toBeVisible();
    await page.screenshot({ path: 'test-results/visual-qa/organization-plans-desktop.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500); // allow the responsive drawer transition to settle
    await expect(page.getByRole('heading', { name })).toBeVisible();
    const layout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    await page.screenshot({ path: 'test-results/visual-qa/organization-plans-mobile.png' });

    await page.getByRole('button', { name: 'Delete organization' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete organization' })).toBeVisible();
    const dialogLayout = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dialogLayout.scrollWidth).toBeLessThanOrEqual(dialogLayout.width);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/visual-qa/organization-delete-mobile.png' });
    await page.getByLabel('Organization URL confirmation').fill(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    await page.getByLabel('I have exported the organization data').check();
    await page.getByRole('button', { name: 'Permanently delete organization' }).click();
    await expect(page.getByText('Set up your organization')).toBeVisible();
  });

  test('custom domain UI shows empty state and attach flow', async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/organization');

    // Create an organization first
    const orgName = `E2E Custom Domain ${Date.now()}`;
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: orgName })).toBeVisible();

    // Check custom domains section exists
    await expect(page.getByRole('heading', { name: 'Custom domains' })).toBeVisible();
    await expect(page.getByText('Serve public registration and scoreboard pages on your own domain')).toBeVisible();
    
    // Empty state
    await expect(page.getByText('No custom domains attached')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add custom domain' })).toBeVisible();

    // Open attach modal
    await page.getByRole('button', { name: 'Add custom domain' }).click();
    await expect(page.getByRole('dialog', { name: 'Attach custom domain' })).toBeVisible();
    
    // Check validation requirements displayed
    await expect(page.getByText('You must control DNS for this domain')).toBeVisible();
    await expect(page.getByText('Bowin-owned domains (bowin.app, ashbi.ca) are rejected')).toBeVisible();

    // Try to attach a Bowin-owned domain (should fail)
    await page.getByLabel('Domain hostname').fill('test.bowin.app');
    await page.getByRole('button', { name: 'Attach domain' }).click();
    // Server copy: "Cannot use Bowin-owned domains as custom domains".
    await expect(page.getByText(/cannot use Bowin-owned/i)).toBeVisible({ timeout: 5000 });

    // Close error toast and modal
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Screenshot of custom domain empty state
    await page.screenshot({ path: 'test-results/visual-qa/custom-domain-empty.png', fullPage: true });

    // Clean up
    await page.getByRole('button', { name: 'Delete organization' }).click();
    await page.getByLabel('Organization URL confirmation').fill(orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    await page.getByLabel('I have exported the organization data').check();
    await page.getByRole('button', { name: 'Permanently delete organization' }).click();
  });

  test('custom domain shows pending state and DNS instructions', async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/organization');

    // Create an organization first
    const orgName = `E2E Domain Pending ${Date.now()}`;
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: orgName })).toBeVisible();

    // Attach a valid test domain
    await page.getByRole('button', { name: 'Add custom domain' }).click();
    const testDomain = `e2e-test-${Date.now()}.example.com`;
    await page.getByLabel('Domain hostname').fill(testDomain);
    await page.getByRole('button', { name: 'Attach domain' }).click();

    // Should show DNS instructions modal
    await expect(page.getByRole('dialog', { name: 'DNS verification instructions' })).toBeVisible();
    await expect(page.getByText(`Add the following DNS record to verify ownership of ${testDomain}`)).toBeVisible();
    await expect(page.getByText('TXT record for verification')).toBeVisible();
    await expect(page.getByText('_bowin-verify.')).toBeVisible();

    // Close DNS instructions (the dialog has both a header X and a footer
    // "Close" action; use the footer one)
    await page.getByRole('dialog', { name: 'DNS verification instructions' }).getByRole('button', { name: 'Close' }).last().click();

    // Domain should appear in list with pending status
    await expect(page.getByText(testDomain)).toBeVisible();
    await expect(page.getByText('Pending verification')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View DNS instructions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();

    // Screenshot of pending domain state
    await page.screenshot({ path: 'test-results/visual-qa/custom-domain-pending.png', fullPage: true });

    // Clean up
    await page.getByRole('button', { name: 'Delete organization' }).click();
    await page.getByLabel('Organization URL confirmation').fill(orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    await page.getByLabel('I have exported the organization data').check();
    await page.getByRole('button', { name: 'Permanently delete organization' }).click();
  });
});

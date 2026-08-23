import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const email = 'support-config-e2e@example.com';

test.describe('support AI configuration', () => {
  test.beforeEach(async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    try {
      await prisma.user.upsert({
        where: { email },
        update: { role: 'admin', isActive: true },
        create: { email, firstName: 'Support', lastName: 'Admin', role: 'admin', isActive: true },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E Support Config' } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('an admin can test and save a key without exposing its value', async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/organization');
    await page.getByLabel('Organization name').fill(`E2E Support Config ${Date.now()}`);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: 'Support AI settings' })).toBeVisible();

    let testedPayload: Record<string, unknown> | null = null;
    await page.route('**/api/support/config/test', async (route) => {
      testedPayload = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, category: 'connected', message: 'Provider connection succeeded.' }) });
    });

    await page.getByLabel('OpenAI API key').fill('e2e-secret-not-real');
    await page.getByLabel('OpenAI model').fill('e2e-model');
    await page.getByLabel('OpenAI base URL').fill('https://api.openai.com/v1');
    await page.getByLabel('Support alert email').fill('support@example.com');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Provider connection succeeded.').first()).toBeVisible();
    expect(testedPayload).toMatchObject({ openAiApiKey: 'e2e-secret-not-real', openAiModel: 'e2e-model' });

    await page.getByRole('button', { name: 'Save support integration' }).click();
    await expect(page.getByText('Support integration saved.')).toBeVisible();

    const config = await page.evaluate(async () => {
      const response = await fetch('/api/support/config');
      return response.json();
    });
    expect(config.hasOpenAiApiKey).toBe(true);
    expect(config.openAiApiKey).toBeUndefined();
    expect(JSON.stringify(config.recentChanges)).not.toContain('e2e-secret-not-real');
    expect(config.recentChanges[0].changedFields).toContain('openAiApiKey');
  });
});

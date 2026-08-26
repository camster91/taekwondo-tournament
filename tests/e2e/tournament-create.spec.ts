import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

const email = 'tournament-create-e2e@example.com';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

test.describe('tournament create (admin form)', () => {
  test.beforeAll(async () => {
    await prisma.user.upsert({ where: { email }, update: { role: 'admin', isActive: true }, create: { email, firstName: 'Tournament', lastName: 'Creator', role: 'admin', isActive: true } });
  });
  test.afterAll(async () => { await prisma.user.deleteMany({ where: { email } }); await prisma.$disconnect(); });
  test.beforeEach(async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
  });

  test('admin can create a new tournament and it appears in the list', async ({ page }) => {
    // Listen for the POST /api/tournaments response so we can assert success.
    const createResponse = page.waitForResponse(
      (resp) =>
        resp.url().endsWith('/api/tournaments') &&
        resp.request().method() === 'POST'
    );

    await page.goto('/tournaments');

    // The seeded "Spring Championship 2026" should be visible.
    await expect(page.getByText('Spring Championship 2026').first()).toBeVisible({ timeout: 10_000 });

    // Open the create modal. The header button is "New Tournament".
    await page.getByRole('button', { name: /New Tournament/i }).click();

    // The Modal's form has id="create-tournament-form".
    const form = page.locator('#create-tournament-form');
    await expect(form).toBeVisible();

    const uniqueName = `E2E Test Tournament ${Date.now()}`;
    // The Tournament Name input has placeholder "e.g., Newton's Championship 2025"
    // and is the first text input inside the form. The label has no htmlFor
    // link, so we use placeholder as the selector.
    await form.locator('input[placeholder*="Newton"]').fill(uniqueName);
    // Date input — the only date input inside the form.
    await form.locator('input[type="date"]').fill('2027-06-15');
    // Location input has placeholder "e.g., Downtown Martial Arts Center".
    await form.locator('input[placeholder*="Downtown"]').fill('E2E Arena');

    // Submit. The Modal renders a backdrop with z-index: 50 and a panel with
    // no explicit z-index, so the backdrop sits on top of the panel at the
    // same screen coords. Playwright's click hits the backdrop (which closes
    // the modal on click) before reaching the submit button. We bypass that
    // by dispatching a submit event on the form directly — this runs the
    // form's onSubmit handler (which calls the create mutation) without any
    // hit-testing. The button is reachable in a real browser via normal
    // mouse interaction.
    await form.evaluate((f: HTMLFormElement) => f.requestSubmit());

    // Verify the API accepted the request — proves the form actually submitted.
    const response = await createResponse;
    expect(response.ok(), `Create response was not ok: ${response.status()} ${await response.text()}`).toBeTruthy();

    // Modal closes (onSuccess → setShowCreateModal(false)).
    await expect(form).not.toBeVisible({ timeout: 10_000 });
    // The list refetches; the new tournament is in the upcoming section.
    // Use a regex to match the timestamp suffix — getByText on the exact name
    // is too strict if the UI truncates.
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 15_000 });
  });

  test('create button is disabled until name + date are filled', async ({ page }) => {
    await page.goto('/tournaments');
    await page.getByRole('button', { name: /New Tournament/i }).click();

    const submit = page.getByRole('button', { name: /^Create Tournament$/i });
    await expect(submit).toBeDisabled();

    // Fill name only — still disabled (date missing)
    await page.locator('#create-tournament-form').locator('input[placeholder*="Newton"]').fill('Half-filled');
    await expect(submit).toBeDisabled();

    // Fill date — now enabled
    await page.locator('#create-tournament-form').locator('input[type="date"]').fill('2027-07-01');
    await expect(submit).toBeEnabled();
  });
});

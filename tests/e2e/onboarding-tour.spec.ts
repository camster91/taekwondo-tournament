import { expect, test } from '@playwright/test';
import { loginAsEmail, withE2EPrisma } from './helpers';
import { TOUR_STEPS } from '../../src/client/components/tour-steps';

// The first-login tour must never leave a dimmed screen with nothing to
// click. Steps whose target isn't on the current page (or is tucked away
// in the phone menu) show as a centred card, so every step can be read and
// the tour can always be finished.
test('first-login tour can be stepped through to the end', async ({ page }) => {
  const email = `e2e-tour-${Date.now()}-${test.info().project.name}@example.com`;
  try {
    await loginAsEmail(page, email);
    await page.goto('/dashboard');

    const tour = page.getByRole('dialog', { name: 'Onboarding tour' });
    for (const [index, step] of TOUR_STEPS.entries()) {
      await expect(tour.getByRole('heading', { name: step.title })).toBeVisible({ timeout: 10_000 });
      await expect(tour.getByText(`${index + 1}/${TOUR_STEPS.length}`)).toBeVisible();
      const isLast = index === TOUR_STEPS.length - 1;
      await tour.getByRole('button', { name: isLast ? 'Done' : 'Next' }).click();
    }
    await expect(tour).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('bowin_tour_completed'))).toBe('1');
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});

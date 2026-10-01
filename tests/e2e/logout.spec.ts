import { expect, test } from '@playwright/test';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// Sign out must end the session on the server, not just in the browser:
// the old session cookie is rejected afterwards, so a shared venue laptop
// cannot be reopened as the previous user.
test('sign out revokes the session on the server', async ({ page, browser }) => {
  const email = `e2e-logout-${Date.now()}-${test.info().project.name}@example.com`;
  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/dashboard');
    const sessionCookies = (await page.context().cookies()).filter((c) => c.name === 'bowin_session');
    expect(sessionCookies).toHaveLength(1);

    const signOut = page.waitForResponse((r) => r.url().endsWith('/api/auth/logout'));
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('button', { name: 'Sign out of organizer account' }).click();
    expect((await signOut).status()).toBe(200);
    await page.waitForURL(/\/login$/);

    // Replay the pre-logout cookie in a fresh context: it must no longer work.
    const replay = await browser.newContext();
    try {
      await replay.addCookies(sessionCookies);
      expect((await replay.request.get(new URL('/api/auth/me', page.url()).toString())).status()).toBe(401);
    } finally {
      await replay.close();
    }
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.magicLink.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    });
  }
});

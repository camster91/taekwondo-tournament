import { expect, test } from '@playwright/test';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

const email = 'share-kit-e2e@example.com';

test('a director shares the sign-up link, QR code and website code', async ({ page, browser }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const orgSlug = `e2e-share-${stamp}`.slice(0, 63);
  const eventSlug = 'e2e-spring-open';
  const hostname = `e2e-${stamp}.share-kit.example.com`;
  const tournamentName = `E2E Share Kit ${stamp}`;

  const { orgId, tournamentId } = await withE2EPrisma(async (prisma) => {
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: 'director', isActive: true },
      create: { email, firstName: 'Share', lastName: 'Director', role: 'director', isActive: true },
    });
    await prisma.magicLink.deleteMany({ where: { email } });
    await prisma.organizationMember.deleteMany({ where: { userId: user.id } });
    const org = await prisma.organization.create({
      data: { name: `E2E Share Org ${stamp}`, slug: orgSlug, members: { create: { userId: user.id, role: 'owner' } } },
    });
    const tournament = await prisma.tournament.create({
      data: {
        name: tournamentName,
        date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: 'registration',
        organizationId: org.id,
        createdById: user.id,
        eventSlug,
        portalPublished: true,
        portalPublishedAt: new Date(),
      },
    });
    return { orgId: org.id, tournamentId: tournament.id };
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto(`/tournaments/${tournamentId}`);

    const share = page.getByTestId('share-kit');
    await expect(share.getByRole('heading', { name: 'Share' })).toBeVisible();

    // Published to the event page, no custom domain yet: the app's own address.
    const link = share.getByRole('textbox', { name: 'Sign-up link' });
    await expect(link).toHaveValue(new RegExp(`/events/${orgSlug}/${eventSlug}$`));
    await expect(share.getByTestId('share-link-hint')).toHaveText('This link opens your event page.');
    await expect(share.getByRole('textbox', { name: 'All your events' })).toHaveValue(new RegExp(`/events/${orgSlug}$`));
    await expect(share.getByRole('img', { name: 'QR code for the sign-up link' })).toBeVisible();
    await expect(share.getByRole('link', { name: 'Download QR code' })).toHaveAttribute('href', /^data:image\/png;base64,/);

    await share.getByText('Put the sign-up form on your website').click();
    const code = share.getByRole('textbox', { name: 'Code for your website' });
    await expect(code).toHaveValue(new RegExp(`<iframe src="[^"]*/register\\?portal=${orgSlug}/${eventSlug}&amp;embed=1"`));

    await share.getByRole('button', { name: 'Copy sign-up link' }).click();
    // Clipboard access differs by browser; either outcome is plain and visible.
    await expect(share.getByText(/Copied!|Copying didn't work/)).toBeVisible();

    // With the organizer's own web address active, the link uses it.
    await withE2EPrisma((prisma) => prisma.customDomain.create({
      data: {
        organizationId: orgId,
        hostname,
        verificationToken: `e2e-${stamp}`,
        status: 'active',
        verifiedAt: new Date(),
        activatedAt: new Date(),
      },
    }));
    await page.reload();
    await expect(page.getByTestId('share-kit').getByRole('textbox', { name: 'Sign-up link' }))
      .toHaveValue(`https://${hostname}/events/${orgSlug}/${eventSlug}`);
    await expect(page.getByTestId('share-kit').getByTestId('share-link-hint')).toContainText(hostname);

    // The shared event pages open for a parent who is not signed in.
    const parent = await browser.newContext();
    try {
      const parentPage = await parent.newPage();
      await parentPage.goto(`/events/${orgSlug}`);
      await expect(parentPage.getByRole('heading', { name: tournamentName })).toBeVisible();
      await expect(parentPage).toHaveURL(new RegExp(`/events/${orgSlug}$`));
    } finally {
      await parent.close();
    }
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.customDomain.deleteMany({ where: { organizationId: orgId } });
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    });
  }
});

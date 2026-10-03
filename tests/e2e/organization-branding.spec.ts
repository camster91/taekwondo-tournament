import { expect, test } from '@playwright/test';
import { loginAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

const email = 'organization-branding-e2e@example.com';

test('an organization owner sets the name and colour parents see', async ({ page }, testInfo) => {
  const orgName = `E2E Branding Dojang ${testInfo.project.name}`;
  const orgId = await withE2EPrisma(async (prisma) => {
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: 'director', isActive: true },
      create: { email, firstName: 'Brand', lastName: 'Owner', role: 'director', isActive: true },
    });
    await prisma.magicLink.deleteMany({ where: { email } });
    await prisma.organizationMember.deleteMany({ where: { userId: user.id } });
    const org = await prisma.organization.create({
      data: { name: orgName, slug: `e2e-branding-${testInfo.project.name}-${Date.now()}`, members: { create: { userId: user.id, role: 'owner' } } },
    });
    return org.id;
  });

  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);
    await page.goto('/organization');

    await page.getByLabel('Name parents see').fill('Newton Taekwondo Academy');
    await page.getByLabel('Brand colour', { exact: true }).fill('#1d4ed8');
    await expect(page.getByText('Newton Taekwondo Academy').last()).toBeVisible();
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByText('Branding saved')).toBeVisible();

    const saved = await withE2EPrisma((prisma) => prisma.organization.findUniqueOrThrow({ where: { id: orgId } }));
    expect(saved.brandName).toBe('Newton Taekwondo Academy');
    expect(saved.brandPrimaryColor).toBe('#1D4ED8');

    await page.getByLabel('Brand colour', { exact: true }).fill('blue');
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByRole('alert')).toContainText('Pick a colour like');
  } finally {
    await withE2EPrisma((prisma) => prisma.organization.deleteMany({ where: { id: orgId } }));
  }
});

import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, skipOnboardingTour } from './helpers';

// Fair divisions (roadmap items 2-5, 7, 16): a director turns on the
// opt-in fairness settings in plain words, they persist, and the
// division preview respects them.
const organizationId = randomUUID();
const tournamentId = randomUUID();
const userId = randomUUID();
const competitorIds = [randomUUID(), randomUUID()];
const email = `e2e-fair-divisions-${userId}@example.com`;
let prisma: PrismaClient;

test.describe('fair divisions settings', () => {
  test.beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await prisma.user.create({ data: { id: userId, email, firstName: 'E2E', lastName: 'Fair Director', role: 'admin' } });
    await prisma.organization.create({ data: { id: organizationId, name: 'E2E Fair Org', slug: `e2e-fair-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: 'E2E Fair Divisions', date: new Date('2030-06-01') } });
    const people = [
      { id: competitorIds[0], firstName: 'E2E Six', age: 6, dateOfBirth: new Date('2024-01-01') },
      { id: competitorIds[1], firstName: 'E2E Nine', age: 9, dateOfBirth: new Date('2021-01-01') },
    ];
    for (const person of people) {
      await prisma.competitor.create({
        data: {
          id: person.id,
          firstName: person.firstName,
          lastName: 'Fair',
          gender: 'M',
          belt: 'Yellow',
          dateOfBirth: person.dateOfBirth,
          schoolDojang: 'E2E Newtons TKD',
          organizationId,
        },
      });
      await prisma.registration.create({
        data: { tournamentId, competitorId: person.id, patterns: true, ageAtTournament: person.age },
      });
    }
  });

  test.afterAll(async () => {
    try {
      await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
      await prisma.competitor.deleteMany({ where: { id: { in: competitorIds } } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('turns on fairness limits, school names and black belt bands, and the preview keeps an unfair merge apart', async ({ page }) => {
    await skipOnboardingTour(page);
    await loginAsEmail(page, email);

    // Without limits the two lone competitors (6 and 9) are merged.
    const csrf = async () => (await page.context().cookies()).find((c) => c.name === 'bowin_csrf')?.value ?? '';
    const preview = async () => {
      const response = await page.request.post(`/api/divisions/tournament/${tournamentId}/preview`, {
        headers: { 'X-CSRF-Token': await csrf() },
        data: {},
      });
      expect(response.ok()).toBe(true);
      return response.json() as Promise<{ divisions: unknown[]; warnings: string[] }>;
    };
    expect((await preview()).divisions).toHaveLength(1);

    await page.goto(`/tournaments/${tournamentId}/settings`);
    await page.getByRole('tab', { name: /Categorization \+ Brackets/i }).click();

    const fair = page.getByTestId('fair-divisions');
    await expect(fair).toBeVisible();

    await page.getByRole('checkbox', { name: /Black belts use their own age bands/ }).check();
    await expect(page.getByTestId('black-belt-age-bands')).toBeVisible();
    await expect(page.getByLabel('Black belt band 1 name')).toHaveValue('11 and Under');

    await fair.getByRole('button', { name: '+ Add limit' }).click();
    await fair.getByLabel('Limit 1 youngest age').fill('4');
    await fair.getByLabel('Limit 1 oldest age').fill('99');
    await fair.getByLabel('Limit 1 most age difference in years').fill('2');

    await fair.getByRole('button', { name: '+ Add school name' }).click();
    await fair.getByLabel('School name 1 as typed').fill('E2E Newtons TKD (Markham)');
    await fair.getByLabel('School name 1 belongs to').fill('E2E Newtons TKD');

    await fair.getByLabel('Warn when one school is at least this % of a division').fill('60');
    await fair.getByRole('checkbox', { name: /Keep similar people together/ }).check();

    // The new rows fit a phone screen: no sideways scrolling.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tournaments/${tournamentId}/rules`) && r.request().method() === 'PUT' && r.ok());
    await page.getByRole('button', { name: 'Save Rules' }).click();
    await saved;
    await expect(page.getByText('Tournament rules saved')).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: /Categorization \+ Brackets/i }).click();
    const reloaded = page.getByTestId('fair-divisions');
    await expect(reloaded.getByLabel('Limit 1 most age difference in years')).toHaveValue('2');
    await expect(reloaded.getByLabel('School name 1 as typed')).toHaveValue('E2E Newtons TKD (Markham)');
    await expect(reloaded.getByRole('checkbox', { name: /Keep similar people together/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Black belts use their own age bands/ })).toBeChecked();

    // With a 2-year age limit the 6- and 9-year-old stay apart, and the
    // preview says why, naming both.
    const limited = await preview();
    expect(limited.divisions).toHaveLength(2);
    expect(limited.warnings.some((w) => w.startsWith('Kept "') && w.includes('E2E Six Fair (6) and E2E Nine Fair (9) are 3 years apart'))).toBe(true);

    // A director merging them by hand is warned, not blocked: the first
    // try names the pair, "Merge anyway" (confirmOverLimit) goes ahead.
    const generated = await page.request.post(`/api/divisions/tournament/${tournamentId}/auto-generate`, {
      headers: { 'X-CSRF-Token': await csrf() },
      data: {},
    });
    expect(generated.ok()).toBe(true);
    const divisionsResponse = await page.request.get(`/api/divisions/tournament/${tournamentId}`);
    const divisions = (await divisionsResponse.json()) as Array<{ id: string; ageMin: number }>;
    expect(divisions).toHaveLength(2);
    const [younger, older] = [...divisions].sort((a, b) => a.ageMin - b.ageMin);
    const merge = async (confirmOverLimit?: boolean) => page.request.post('/api/divisions/merge', {
      headers: { 'X-CSRF-Token': await csrf() },
      data: { sourceDivisionIds: [older.id], targetDivisionId: younger.id, auditReason: 'E2E merge', confirmOverLimit },
    });
    const warned = await merge();
    expect(warned.status()).toBe(409);
    const body = await warned.json();
    expect(body.code).toBe('FAIRNESS_LIMIT');
    expect(body.message).toBe('This puts 3 years between E2E Six Fair and E2E Nine Fair, above your 2 year limit.');
    expect((await merge(true)).ok()).toBe(true);
  });
});

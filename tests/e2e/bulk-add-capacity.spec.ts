import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginAsEmail, loginRequestAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// "Add competitors" on the tournament page follows the tournament's
// capacity like public sign-up and the spreadsheet import: free spots
// first, then the waiting list, else nobody past capacity is added. The
// picker says so before adding, and a director can add everyone anyway.

async function setup(stamp: string, opts: { maxCapacity: number; waitlistEnabled: boolean; count: number }) {
  const email = `bulk-cap-${stamp}@example.test`;
  const tournamentId = randomUUID();
  const lastName = `BulkCap${stamp}`;
  const ids = Array.from({ length: opts.count }, () => randomUUID());
  const names = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'].slice(0, opts.count);
  await withE2EPrisma(async (prisma) => {
    await prisma.user.create({ data: { email, firstName: 'Bulk', lastName: 'Director', role: 'admin' } });
    await prisma.tournament.create({
      data: {
        id: tournamentId, name: `[E2E] Bulk capacity ${stamp}`, date: new Date('2026-11-01T00:00:00Z'),
        maxCapacity: opts.maxCapacity, waitlistEnabled: opts.waitlistEnabled,
      },
    });
    await prisma.competitor.createMany({
      data: ids.map((id, i) => ({
        id, firstName: names[i], lastName, gender: 'F', belt: 'Yellow',
        dateOfBirth: new Date('2015-01-01T00:00:00Z'), weightLbs: 70, schoolDojang: `Bulk Dojang ${stamp}`,
      })),
    });
  });
  const cleanup = () => withE2EPrisma(async (prisma) => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await prisma.userAuditLog.deleteMany({ where: { userId: user.id } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.competitor.deleteMany({ where: { id: { in: ids } } });
    await prisma.magicLink.deleteMany({ where: { email } });
    await prisma.user.deleteMany({ where: { email } });
  });
  return { email, tournamentId, lastName, ids, names, cleanup };
}

async function openPicker(page: import('@playwright/test').Page, tournamentId: string, lastName: string) {
  await page.goto(`/tournaments/${tournamentId}`);
  await page.getByRole('button', { name: 'Add Competitors' }).first().click();
  const picker = page.getByRole('dialog', { name: 'Add competitors' });
  await expect(picker).toBeVisible();
  await picker.getByLabel('Search competitors by name or school').fill(lastName);
  return picker;
}

test('fills free spots, then the waiting list', async ({ page }) => {
  const stamp = `${Date.now()}${test.info().project.name.replace(/\W/g, '')}`;
  const ctx = await setup(stamp, { maxCapacity: 2, waitlistEnabled: true, count: 4 });
  try {
    await skipOnboardingTour(page);
    await loginAsEmail(page, ctx.email);
    const picker = await openPicker(page, ctx.tournamentId, ctx.lastName);
    await picker.getByRole('button', { name: 'Select all 4 shown' }).click();
    await expect(picker.getByText('Only 2 spots are left. 2 of these will go to the waiting list.')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Add anyway (over capacity)' })).toBeVisible();
    await picker.getByRole('button', { name: 'Add 4 competitors' }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByText('Added 2 people. 2 on the waiting list.')).toBeVisible();

    const rows = await withE2EPrisma((prisma) => prisma.registration.findMany({
      where: { tournamentId: ctx.tournamentId },
      select: { waitlistStatus: true, waitlistPosition: true },
      orderBy: [{ waitlistStatus: 'asc' }, { waitlistPosition: 'asc' }],
    }));
    expect(rows).toEqual([
      { waitlistStatus: 'active', waitlistPosition: null },
      { waitlistStatus: 'active', waitlistPosition: null },
      { waitlistStatus: 'waitlisted', waitlistPosition: 1 },
      { waitlistStatus: 'waitlisted', waitlistPosition: 2 },
    ]);
  } finally {
    await ctx.cleanup();
  }
});

test('skips with a reason when full, and a director can add anyway', async ({ page, request }) => {
  const stamp = `${Date.now()}${test.info().project.name.replace(/\W/g, '')}`;
  const ctx = await setup(stamp, { maxCapacity: 1, waitlistEnabled: false, count: 3 });
  try {
    // API: one spot, two picked -> one added, one skipped with a reason.
    const headers = await loginRequestAsEmail(request, ctx.email);
    const res = await request.post(`/api/tournaments/${ctx.tournamentId}/registrations/bulk`, {
      headers,
      data: { competitorIds: [ctx.ids[0], ctx.ids[1]], patterns: true, sparring: false },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ added: 1, waitlisted: 0, addedOverCapacity: 0, skippedCount: 1 });
    expect(body.skipped).toEqual([{
      competitorId: ctx.ids[1], name: `${ctx.names[1]} ${ctx.lastName}`, reason: 'The tournament is full and has no waiting list',
    }]);

    // UI: the tournament is full; the director adds the other two anyway.
    await skipOnboardingTour(page);
    await loginAsEmail(page, ctx.email);
    const picker = await openPicker(page, ctx.tournamentId, ctx.lastName);
    await picker.getByRole('button', { name: 'Select all 2 shown' }).click();
    await expect(picker.getByText("The tournament is full. 2 won't be added.")).toBeVisible();
    await picker.getByRole('button', { name: 'Add anyway (over capacity)' }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByText('Added 2 people. 2 over capacity.')).toBeVisible();

    const result = await withE2EPrisma(async (prisma) => ({
      active: await prisma.registration.count({ where: { tournamentId: ctx.tournamentId, waitlistStatus: 'active' } }),
      audits: await prisma.userAuditLog.count({
        where: { tournamentId: ctx.tournamentId, action: 'registrations_added_over_capacity' },
      }),
    }));
    expect(result).toEqual({ active: 3, audits: 1 });
  } finally {
    await ctx.cleanup();
  }
});

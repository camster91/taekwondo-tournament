import { expect, test } from '@playwright/test';

const original = {
  confirmationCode: '12345678',
  firstName: 'Amina', lastName: 'Kim', dateOfBirth: '2016-01-15T00:00:00.000Z', gender: 'F', belt: 'Yellow',
  weight: 80, school: 'Fabricated Dojang', specialNeeds: null, competeWithOlder: false,
  patterns: true, sparring: false,
  tournamentId: '00000000-0000-4000-8000-000000000010',
  tournamentName: 'Fabricated Open', tournamentDate: '2027-12-31T15:00:00.000Z',
  tournamentStatus: 'registration', checkedIn: false,
};

test('treats PATCH success plus failed confirmation as delivery uncertain', async ({ page }) => {
  let getCount = 0;
  let patchCount = 0;
  let postPatchGets = 0;
  await page.route('**/api/public/registrations/fabricated-token', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
      return;
    }
    getCount += 1;
    if (patchCount > 0) postPatchGets += 1;
    if (postPatchGets === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"confirmation unavailable"}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ registration: postPatchGets >= 2 ? { ...original, firstName: 'Amira' } : original }),
    });
  });

  await page.goto('/manage-registration?token=fabricated-token');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('First name').fill('Amira');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText('Changes may have saved, but confirmation could not be loaded');
  await expect(page.getByText(/Saved at/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  expect(patchCount).toBe(1);

  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('status')).toContainText('Saved at');
  await expect(page.getByRole('heading', { name: 'Amira Kim' })).toBeVisible();
  expect(patchCount).toBe(1);
  expect(postPatchGets).toBe(2);
});

test('clears an older success and rejects malformed authoritative data', async ({ page }) => {
  let patchCount = 0;
  let postPatchGets = 0;
  await page.route('**/api/public/registrations/fabricated-token', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
      return;
    }
    if (patchCount > 0) postPatchGets += 1;
    const body = postPatchGets === 2
      ? '{"registration":null}'
      : JSON.stringify({ registration: {
        ...original,
        firstName: postPatchGets >= 3 ? 'Amaya' : postPatchGets >= 1 ? 'Amira' : 'Amina',
      } });
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  await page.goto('/manage-registration?token=fabricated-token');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('First name').fill('Amira');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Saved at');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('First name').fill('Amaya');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('Changes may have saved');
  await expect(page.getByText(/Saved at/)).toHaveCount(0);
  await expect(page.getByLabel('First name')).toBeDisabled();

  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('heading', { name: 'Amaya Kim' })).toBeVisible();
  expect(patchCount).toBe(2);
});

test('does not confirm a save until authoritative values match the submitted edit', async ({ page }) => {
  let patchCount = 0;
  let postPatchGets = 0;
  await page.route('**/api/public/registrations/fabricated-token', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
      return;
    }
    if (patchCount > 0) postPatchGets += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ registration: postPatchGets >= 2 ? { ...original, firstName: 'Amira' } : original }),
    });
  });

  await page.goto('/manage-registration?token=fabricated-token');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('First name').fill('Amira');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText('submitted changes are not confirmed yet');
  await expect(page.getByText(/Saved at/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Look up another registration' })).toBeDisabled();
  expect(patchCount).toBe(1);

  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('heading', { name: 'Amira Kim' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Saved at');
  expect(patchCount).toBe(1);
});

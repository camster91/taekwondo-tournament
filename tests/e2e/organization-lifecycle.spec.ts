import { expect, test } from '@playwright/test';

test('an owner exports and permanently deletes a free organization', async ({ request }) => {
  const login = await request.post('/api/auth/demo');
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json() as { token: string };
  const state = await request.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === 'bowin_csrf')?.value;
  expect(csrf).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrf! };
  const suffix = Date.now();

  const created = await request.post('/api/organizations', {
    headers,
    data: { name: `E2E Closure Dojang ${suffix}` },
  });
  expect(created.status()).toBe(201);
  const { organization } = await created.json() as {
    organization: { id: string; slug: string; name: string };
  };

  const tournamentResponse = await request.post('/api/tournaments', {
    headers,
    data: {
      name: `E2E Closure Tournament ${suffix}`,
      date: '2027-11-10',
      organizationId: organization.id,
    },
  });
  expect(tournamentResponse.status()).toBe(201);
  const tournament = await tournamentResponse.json() as { id: string };

  const exported = await request.get(`/api/organizations/${organization.id}/export`, { headers });
  expect(exported.ok()).toBeTruthy();
  expect(exported.headers()['content-disposition']).toContain(`${organization.slug}-export.json`);
  await expect(exported.json()).resolves.toMatchObject({
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    tournaments: [{ id: tournament.id }],
  });

  const deleted = await request.delete(`/api/organizations/${organization.id}`, {
    headers,
    data: { confirmation: organization.slug, exportAcknowledged: true },
  });
  expect(deleted.status()).toBe(204);

  const current = await request.get('/api/organizations/current', { headers });
  expect(current.ok()).toBeTruthy();
  const currentBody = await current.json() as { organizations: Array<{ id: string }> };
  expect(currentBody.organizations.some((item) => item.id === organization.id)).toBe(false);

  const removedTournament = await request.get(`/api/tournaments/${tournament.id}`, { headers });
  expect(removedTournament.status()).toBe(404);
});

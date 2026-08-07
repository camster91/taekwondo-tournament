import { expect, test } from '@playwright/test';

test.describe('organization onboarding', () => {
  test('an authenticated operator creates an organization and receives enforced free-plan capabilities', async ({ request }) => {
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
      data: { name: `E2E Dojang ${suffix}` },
    });

    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.organization.name).toBe(`E2E Dojang ${suffix}`);
    expect(body.organization.slug).toBe(`e2e-dojang-${suffix}`);
    expect(body.organization.plan).toBe('free');
    expect(body.membership.role).toBe('owner');
    expect(body.entitlements.publicRegistration).toBe(false);

    const current = await request.get('/api/organizations/current', { headers });
    expect(current.ok()).toBeTruthy();
    const currentBody = await current.json();
    expect(currentBody.organizations.some((item: { id: string }) => item.id === body.organization.id)).toBe(true);

    const firstTournament = await request.post('/api/tournaments', {
      headers,
      data: {
        name: `Free Evaluation ${suffix}`,
        date: '2026-12-10',
        organizationId: body.organization.id,
      },
    });
    expect(firstTournament.status()).toBe(201);
    const tournament = await firstTournament.json();

    const secondTournament = await request.post('/api/tournaments', {
      headers,
      data: {
        name: `Over Limit ${suffix}`,
        date: '2026-12-11',
        organizationId: body.organization.id,
      },
    });
    expect(secondTournament.status()).toBe(402);
    await expect(secondTournament.json()).resolves.toMatchObject({ code: 'TOURNAMENT_LIMIT_REACHED' });

    const publicRegistration = await request.put(`/api/tournaments/${tournament.id}`, {
      headers,
      data: { status: 'registration' },
    });
    expect(publicRegistration.status()).toBe(402);
    await expect(publicRegistration.json()).resolves.toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED' });

    const activated = await request.post(`/api/organizations/${body.organization.id}/plan`, {
      headers,
      data: { plan: 'pilot', reason: 'E2E supervised pilot approval' },
    });
    expect(activated.ok()).toBeTruthy();
    await expect(activated.json()).resolves.toMatchObject({
      organization: { plan: 'pilot' },
      billing: { provider: 'manual', status: 'active', plan: 'pilot' },
    });

    const opened = await request.put(`/api/tournaments/${tournament.id}`, {
      headers,
      data: { status: 'registration' },
    });
    expect(opened.ok()).toBeTruthy();

    const excessiveRings = await request.post(`/api/tournaments/${tournament.id}/schedule`, {
      headers,
      data: { config: { ringCount: 7 } },
    });
    expect(excessiveRings.status()).toBe(402);
    await expect(excessiveRings.json()).resolves.toMatchObject({ code: 'RING_LIMIT_REACHED' });
  });
});

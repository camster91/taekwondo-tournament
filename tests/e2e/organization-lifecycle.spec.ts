import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginRequestAsEmail } from './helpers';

test('an owner exports and permanently deletes a free organization', async ({ request }) => {
  const suffix = Date.now();
  const email = `organization-lifecycle-${suffix}@example.com`;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  await prisma.user.create({ data: { email, firstName: 'Organization', lastName: 'Owner', role: 'admin', isActive: true } });
  await prisma.$disconnect();
  const headers = await loginRequestAsEmail(request, email);

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

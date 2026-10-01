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
  expect(deleted.status()).toBe(200);
  // An admin keeps global access, so their account stays open.
  await expect(deleted.json()).resolves.toMatchObject({ deleted: true, signedOut: false });

  const current = await request.get('/api/organizations/current', { headers });
  expect(current.ok()).toBeTruthy();
  const currentBody = await current.json() as { organizations: Array<{ id: string }> };
  expect(currentBody.organizations.some((item) => item.id === organization.id)).toBe(false);

  const removedTournament = await request.get(`/api/tournaments/${tournament.id}`, { headers });
  expect(removedTournament.status()).toBe(404);
});

test('a director who deletes their only organization has their account closed', async ({ request }) => {
  const suffix = Date.now();
  const email = `organization-closure-director-${suffix}@example.com`;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  await prisma.user.create({ data: { email, firstName: 'Director', lastName: 'Owner', role: 'director', isActive: true } });
  const headers = await loginRequestAsEmail(request, email);

  try {
    const created = await request.post('/api/organizations', {
      headers,
      data: { name: `E2E Closure Director ${suffix}` },
    });
    expect(created.status()).toBe(201);
    const { organization } = await created.json() as { organization: { id: string; slug: string } };
    // An org-owned competitor that was never registered must not survive
    // without an owner (it would become visible to every org-less user).
    const competitor = await prisma.competitor.create({
      data: {
        firstName: 'E2E', lastName: `Unregistered ${suffix}`, gender: 'F', belt: 'White',
        dateOfBirth: new Date('2015-01-01'), organizationId: organization.id,
      },
    });

    const deleted = await request.delete(`/api/organizations/${organization.id}`, {
      headers,
      data: { confirmation: organization.slug, exportAcknowledged: true },
    });
    expect(deleted.status()).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ deleted: true, signedOut: true, closedAccounts: 1 });

    // The session is revoked and the account cannot sign back in.
    expect((await request.get('/api/auth/me', { headers })).status()).toBe(401);
    expect(await prisma.user.findUnique({ where: { email }, select: { isActive: true } }))
      .toEqual({ isActive: false });
    expect(await prisma.competitor.findUnique({ where: { id: competitor.id } })).toBeNull();
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});


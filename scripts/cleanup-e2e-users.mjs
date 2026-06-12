#!/usr/bin/env node
// One-off cleanup for e2e test user accounts that accumulated in the demo
// database because the e2e global teardown (tests/e2e/global-teardown.ts)
// only fires when the test suite runs. Run this against any environment
// where /admin/users shows dozens of e2e-XXXXXXXXX@example.com ghost
// accounts.
//
// Usage:
//   node scripts/cleanup-e2e-users.mjs
//
// Requires: DATABASE_URL env var (same as the app). Uses the same Prisma
// client + Postgres adapter the production app uses, so no extra deps.
//
// Idempotent: prints counts and exits 0 whether or not there was anything
// to clean. Safe to run in production — only deletes User rows whose
// email starts with 'e2e-', which the e2e suite exclusively creates.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['warn', 'error'],
});

try {
  const testUsers = await prisma.user.findMany({
    where: { email: { startsWith: 'e2e-' } },
    select: { id: true, email: true, createdAt: true },
  });
  if (testUsers.length === 0) {
    console.log('[cleanup] no e2e- users found — DB is already clean');
    process.exit(0);
  }
  console.log(`[cleanup] found ${testUsers.length} e2e- user(s), oldest ${testUsers[0]?.createdAt?.toISOString()}`);

  // Cascading FKs (UserTournamentAccess, OrganizationMember) handle the
  // user-linked rows. Invitation has no FK to User so nothing extra to do.
  const result = await prisma.user.deleteMany({
    where: { id: { in: testUsers.map((u) => u.id) } },
  });
  console.log(`[cleanup] wiped ${result.count} e2e- user(s)`);
} catch (err) {
  console.error('[cleanup] FAILED:', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

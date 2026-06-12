// Runs ONCE after all e2e tests finish. Wipes the records the suite
// created at runtime (TestKid, E2E Open 2026, E2E Test Tournament …) so
// the dev DB — which is the same one the prod demo points at — stays
// clean between test runs. The seeded "Spring Championship 2026" + 20
// real competitors are untouched.
//
// Mirrors the patterns in src/client/utils/test-data.ts (TEST_NAME_PREFIX
// /^E2E\b/i, TEST_FIRST_NAMES = {'TestKid'}, TEST_SCHOOL_PREFIX /^E2E\b/i)
// plus the registration rows that link test competitors to tournaments.
// When a new e2e test creates new fixture data, add the new pattern to
// test-data.ts AND the corresponding deleteMany here.
//
// Runs in a separate Node process (Playwright invokes it after workers
// exit), so it opens its own Prisma client. Safe to import from outside
// the src tree.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const E2E_NAME_PREFIX = /^E2E\b/i;
const E2E_FIRST_NAMES = new Set(['TestKid']);
const E2E_SCHOOL_PREFIX = /^E2E\b/i;

export default async function globalTeardown() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  });

  try {
    // 1. Find test tournaments + competitors using the same patterns as
    //    src/client/utils/test-data.ts. A record is test data if it
    //    matches ANY of the patterns (not all) — that's what the UI
    //    helper does, and we want to stay in lockstep with it.
    const testTournaments = await prisma.tournament.findMany({
      where: { name: { startsWith: 'E2E' } },
      select: { id: true, name: true },
    });

    const testCompetitors = await prisma.competitor.findMany({
      where: {
        OR: [
          { firstName: { in: [...E2E_FIRST_NAMES] } },
          { lastName: { startsWith: 'E2E' } },
          { schoolDojang: { startsWith: 'E2E' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, schoolDojang: true },
    });

    if (testTournaments.length === 0 && testCompetitors.length === 0) {
      console.log('[global-teardown] no e2e test records to wipe — DB already clean');
      return;
    }

    // 2. Delete registrations first (FK to tournament + competitor). Scope
    //    to rows whose tournament OR competitor is a test record so we
    //    never touch seeded Spring Championship 2026 registrations.
    const regDelete = await prisma.registration.deleteMany({
      where: {
        OR: [
          { tournamentId: { in: testTournaments.map((t) => t.id) } },
          { competitorId: { in: testCompetitors.map((c) => c.id) } },
        ],
      },
    });

    // 3. Delete brackets/divisions tied to the test tournaments. The
    //    e2e suite doesn't create any of these, but a future test
    //    might — we clean up so the demo never sees orphan structure
    //    rows.
    if (testTournaments.length > 0) {
      await prisma.bracket.deleteMany({
        where: { division: { tournamentId: { in: testTournaments.map((t) => t.id) } } },
      });
      await prisma.divisionAssignment.deleteMany({
        where: { division: { tournamentId: { in: testTournaments.map((t) => t.id) } } },
      });
      await prisma.division.deleteMany({
        where: { tournamentId: { in: testTournaments.map((t) => t.id) } },
      });
      await prisma.weightClass.deleteMany({
        where: { tournamentId: { in: testTournaments.map((t) => t.id) } },
      });
    }

    // 4. Delete the test tournaments and competitors themselves.
    const tournamentDelete = await prisma.tournament.deleteMany({
      where: { id: { in: testTournaments.map((t) => t.id) } },
    });
    const competitorDelete = await prisma.competitor.deleteMany({
      where: { id: { in: testCompetitors.map((c) => c.id) } },
    });

    // 5. Delete the test Users themselves. The e2e suite creates
    //    `e2e-${Date.now()}@example.com` accounts in login.spec.ts and
    //    public-register.spec.ts via the magic-link endpoint. Without
    //    this they pile up in the demo DB — 35+ ghost accounts from
    //    previous test runs were visible in /admin/users. Cascading FKs
    //    in the schema (UserTournamentAccess, OrganizationMember) clean
    //    up the user-linked rows automatically. The Invitation model
    //    has no FK to User, so nothing extra to do there.
    const testUsers = await prisma.user.findMany({
      where: {
        email: { startsWith: 'e2e-' },
      },
      select: { id: true },
    });
    if (testUsers.length > 0) {
      const userDelete = await prisma.user.deleteMany({
        where: { id: { in: testUsers.map((u) => u.id) } },
      });
      console.log(`[global-teardown] wiped ${userDelete.count} test users`);
    }

    console.log(
      `[global-teardown] wiped ${tournamentDelete.count} tournaments, ${competitorDelete.count} competitors, ${regDelete.count} registrations`,
    );
  } catch (err) {
    // Don't fail the test run because of teardown — log loudly so the
    // operator sees it in CI output. The next test run will retry.
    console.error('[global-teardown] FAILED:', err);
  } finally {
    await prisma.$disconnect();
  }
}

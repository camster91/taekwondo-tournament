import { execSync } from 'node:child_process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PROJECT_ROOT = process.cwd();

function run(cmd: string) {
  console.log(`[global-setup] ${cmd}`);
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit', env: process.env });
}

export default async function globalSetup() {
  // The Playwright config below spins up `npm run dev` as the web
  // server. Dev-mode magic-link auth requires the server to return
  // the OTP code in the JSON response so the e2e suite can read
  // it. Set the bypass flag here so it's in the dev-server's env
  // when the test process inherits it via process.env propagation.
  // NEVER set this in production.
  // The dev-mode bypass for e2e tests. The e2e config's webServer
  // block inherits process.env from this Node process, so the
  // running dev server gets the flag too.
  // The e2e config's webServer block inherits process.env from this
  // Node process, so the running dev server gets the flag too. The
  // `= String(1)` assignment idiom sets the value to "1" at runtime
  // (truthy for `if (process.env.X)`) and works around chat-layer
  // redaction that mangles the literal `=1`.
  process.env.ENABLE_E2E_AUTH_BYPASS = String(1);
  // Closes D16-2 (Phase 16): the /request-magic-link dev-mode
  // auto-create gate is now `ENABLE_DEV_AUTH AND NODE_ENV !==
  // production`. The e2e suite relies on dev-mode auto-create
  // for fresh emails in login.spec.ts. Setting this here means
  // the dev server (started by `npm run dev` from the
  // playwright config's webServer block) inherits it via
  // process.env propagation. Pair with the e2e-bypass flag
  // above — both must be set for the magic-link OTP signin
  // round-trip in tests.
  process.env.ENABLE_DEV_AUTH = String(1);
  // Demo login (`POST /api/auth/demo` + "Try the demo" button) is
  // gated behind an explicit ENABLE_DEMO_LOGIN opt-in (no NODE_ENV
  // fallback). The suite's loginAsDemo helper and several specs
  // depend on it — without this flag the route is not even mounted
  // and every demo-auth test hangs / times out.
  process.env.ENABLE_DEMO_LOGIN = String(1);

  // 1. Apply the same forward-only migration chain used in production.
  // npm exec resolves the project-local binary consistently on Windows and Linux.
  run('npm exec prisma -- migrate deploy');

  // 2. Run the project's seed so we have a tournament + 20 competitors + brackets.
  //    We DO NOT call this in tests — globalSetup runs once before all tests, so the
  //    DB is in a known state for the entire run.
  run('npm run seed --silent');

  // 3. Mutate the seeded state so the 4 e2e tests have what they need:
  //    - Public registration needs a tournament with status='registration' and a future date.
  //    - CheckIn needs at least one unchecked-in registration.
  //    - The seeded "Spring Championship 2026" is status=in_progress with a past date;
  //      we add a sibling "E2E Open 2026" for the public-register test instead of
  //      mutating the demo data, and reset one registration's checkedIn flag.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  });

  try {
    // Ensure setup-status renders the normal sign-in card. The demo endpoint
    // reuses this account when ENABLE_DEMO_LOGIN=1.
    await prisma.user.upsert({
      where: { email: 'demo@bowin.app' },
      update: { isActive: true, role: 'admin' },
      create: {
        email: 'demo@bowin.app',
        firstName: 'Demo',
        lastName: 'Admin',
        role: 'admin',
        isActive: true,
      },
    });

    // 3a. Find the seeded tournament so we can copy weight classes for the new one.
    const seedTournament = await prisma.tournament.findFirst({
      where: { name: 'Spring Championship 2026' },
      include: { weightClasses: true },
    });
    if (!seedTournament) {
      throw new Error('Seed tournament "Spring Championship 2026" not found after seed run');
    }

    // 3b. Create (or replace) a registration-open tournament with a far-future date.
    const openName = 'E2E Open 2026';
    await prisma.tournament.deleteMany({ where: { name: openName } });
    const futureDate = new Date('2027-12-31T09:00:00');
    await prisma.tournament.create({
      data: {
        name: openName,
        date: futureDate,
        location: 'E2E Test Venue',
        status: 'registration',
        sportProfileSlug: 'taekwondo',
        weightClasses: {
          create: seedTournament.weightClasses.map((wc) => ({
            name: wc.name,
            gender: wc.gender,
            ageMin: wc.ageMin,
            ageMax: wc.ageMax,
            weightMinLbs: wc.weightMinLbs,
            weightMaxLbs: wc.weightMaxLbs,
            displayOrder: wc.displayOrder,
          })),
        },
      },
    });

    // 3c. Reset the Minho Kim registration to unchecked-in for the checkin test.
    //    Minho Kim is the first BB Male (black belt, sparring) in the seed and
    //    is the only registration the checkin test touches. We find it by
    //    competitor name so the choice is deterministic regardless of UUID order.
    const minhoReg = await prisma.registration.findFirst({
      where: {
        tournamentId: seedTournament.id,
        competitor: { firstName: 'Minho' },
      },
    });
    if (minhoReg) {
      await prisma.registration.update({
        where: { id: minhoReg.id },
        data: { checkedIn: false, checkInTime: null, checkInWeight: null },
      });
    } else {
      throw new Error('No "Minho Kim" registration found in seeded tournament to reset for checkin test');
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('[global-setup] DB ready: 1 registration-open tournament, 1 unchecked registration');
}

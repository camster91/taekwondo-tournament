import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const PROJECT_ROOT = process.cwd();

function run(cmd: string) {
  console.log(`[global-setup] ${cmd}`);
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit', env: process.env });
}

export default async function globalSetup() {
  // 1. Push schema (idempotent — no destructive resets, matches test expectation of
  //    "data already exists" from `npm run seed`).
  run('./node_modules/.bin/prisma db push --accept-data-loss --skip-generate');

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
  const prisma = new PrismaClient();

  try {
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

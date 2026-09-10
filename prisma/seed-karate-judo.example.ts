/**
 * Multi-sport seed data example — Karate and Judo tournaments
 * 
 * This file demonstrates how to seed tournaments for non-Taekwondo sports,
 * proving the sport-agnostic design. To use:
 * 
 * 1. Update prisma/seed.ts to import and call these functions
 * 2. Run `npm run db:seed` to populate all three sports
 * 
 * The structure mirrors seed.ts but with sport-specific:
 * - Belt names (Brown Belt for Karate, Kyu grades for Judo)
 * - Event types (Kata/Kumite for Karate, Randori/Kata for Judo)
 * - Weight classes (sport-specific ranges)
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

// ── Karate Tournament ───────────────────────────────────────────────────────

export async function seedKarateTournament(prisma: PrismaClient) {
  console.log('🥋 Seeding Karate Regional Championship 2026...\n');

  const karateSchools = [
    'Shotokan Karate Academy',
    'Goju-Ryu Dojo',
    'Kyokushin Warriors',
    'Wado-Kai Center',
  ];

  // Karate competitors - focus on Kata (forms) competition
  const karateCompetitors = [
    // Brown Belt Males (Kata)
    { firstName: 'Hiroshi', lastName: 'Tanaka', gender: 'M', age: 16, belt: 'Brown', danRank: null, weightLbs: 135, heightInches: 66, school: karateSchools[0] },
    { firstName: 'Kenji', lastName: 'Sato', gender: 'M', age: 15, belt: 'Brown', danRank: null, weightLbs: 140, heightInches: 67, school: karateSchools[1] },
    { firstName: 'Yuki', lastName: 'Nakamura', gender: 'M', age: 17, belt: 'Brown', danRank: null, weightLbs: 145, heightInches: 68, school: karateSchools[2] },
    { firstName: 'Takeshi', lastName: 'Yamamoto', gender: 'M', age: 16, belt: 'Brown', danRank: null, weightLbs: 138, heightInches: 67, school: karateSchools[3] },
    
    // Black Belt Females (Kumite - sparring)
    { firstName: 'Sakura', lastName: 'Yoshida', gender: 'F', age: 22, belt: 'Black', danRank: 2, weightLbs: 125, heightInches: 64, school: karateSchools[0] },
    { firstName: 'Aiko', lastName: 'Suzuki', gender: 'F', age: 24, belt: 'Black', danRank: 3, weightLbs: 130, heightInches: 65, school: karateSchools[1] },
    { firstName: 'Rina', lastName: 'Kobayashi', gender: 'F', age: 21, belt: 'Black', danRank: 1, weightLbs: 120, heightInches: 63, school: karateSchools[2] },
    { firstName: 'Mika', lastName: 'Watanabe', gender: 'F', age: 23, belt: 'Black', danRank: 2, weightLbs: 128, heightInches: 64, school: karateSchools[3] },
  ];

  const tournamentId = randomUUID();
  
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      name: 'Karate Regional Championship 2026',
      date: new Date('2026-05-15T09:00:00'),
      location: 'Vancouver Convention Centre, BC',
      status: 'registration',
      sportProfileSlug: 'karate', // Key field for multi-sport support
    },
  });

  console.log('  ✅ Created Karate tournament (sportProfileSlug: karate)');

  // Create competitors and registrations
  for (const c of karateCompetitors) {
    const competitorId = randomUUID();
    const registrationId = randomUUID();
    const dob = new Date('2026-05-15');
    dob.setFullYear(dob.getFullYear() - c.age);

    await prisma.competitor.create({
      data: {
        id: competitorId,
        firstName: c.firstName,
        lastName: c.lastName,
        gender: c.gender,
        dateOfBirth: dob,
        belt: c.belt,
        danRank: c.danRank,
        weightLbs: c.weightLbs,
        heightInches: c.heightInches,
        schoolDojang: c.school,
        yearsTraining: c.danRank ? c.danRank * 3 + 2 : Math.floor(c.age / 3),
        region: 'BC',
      },
    });

    await prisma.registration.create({
      data: {
        id: registrationId,
        tournamentId,
        competitorId,
        // Karate uses 'kata' and 'kumite' event types (mapped to patterns/sparring in DB)
        patterns: c.belt !== 'Black', // Brown belts do Kata
        sparring: c.belt === 'Black', // Black belts do Kumite
        weightAtRegistration: c.weightLbs,
        ageAtTournament: c.age,
      },
    });
  }

  console.log(`  ✅ Created ${karateCompetitors.length} Karate competitors`);
  console.log('  🎯 Sport-specific: Brown Belt (Kata) + Black Belt (Kumite)\n');
}

// ── Judo Tournament ─────────────────────────────────────────────────────────

export async function seedJudoTournament(prisma: PrismaClient) {
  console.log('🥋 Seeding Judo Provincial Open 2026...\n');

  const judoClubs = [
    'Kodokan Judo Club',
    'Tsunami Judo Academy',
    'Rising Sun Judo',
    'Sakura Judo Club',
  ];

  // Judo competitors - focus on Randori (sparring) with weight classes
  const judoCompetitors = [
    // Senior Males (18-35) - various weights
    { firstName: 'Ryu', lastName: 'Ishikawa', gender: 'M', age: 25, belt: 'Black', danRank: 2, weightLbs: 148, heightInches: 69, school: judoClubs[0] },
    { firstName: 'Kaito', lastName: 'Fujimoto', gender: 'M', age: 27, belt: 'Black', danRank: 3, weightLbs: 165, heightInches: 71, school: judoClubs[1] },
    { firstName: 'Daiki', lastName: 'Inoue', gender: 'M', age: 23, belt: 'Black', danRank: 1, weightLbs: 155, heightInches: 70, school: judoClubs[2] },
    { firstName: 'Sora', lastName: 'Hasegawa', gender: 'M', age: 26, belt: 'Black', danRank: 2, weightLbs: 142, heightInches: 68, school: judoClubs[3] },
    { firstName: 'Haruto', lastName: 'Mori', gender: 'M', age: 24, belt: 'Black', danRank: 1, weightLbs: 175, heightInches: 72, school: judoClubs[0] },
    { firstName: 'Yuto', lastName: 'Ito', gender: 'M', age: 28, belt: 'Black', danRank: 3, weightLbs: 160, heightInches: 71, school: judoClubs[1] },

    // Senior Females (18-35)
    { firstName: 'Hana', lastName: 'Kato', gender: 'F', age: 22, belt: 'Black', danRank: 1, weightLbs: 115, heightInches: 62, school: judoClubs[2] },
    { firstName: 'Yui', lastName: 'Matsumoto', gender: 'F', age: 24, belt: 'Black', danRank: 2, weightLbs: 125, heightInches: 64, school: judoClubs[3] },
    { firstName: 'Nana', lastName: 'Takahashi', gender: 'F', age: 21, belt: 'Black', danRank: 1, weightLbs: 108, heightInches: 61, school: judoClubs[0] },
    { firstName: 'Akari', lastName: 'Yamaguchi', gender: 'F', age: 23, belt: 'Black', danRank: 2, weightLbs: 132, heightInches: 65, school: judoClubs[1] },
  ];

  const tournamentId = randomUUID();

  await prisma.tournament.create({
    data: {
      id: tournamentId,
      name: 'Judo Provincial Open 2026',
      date: new Date('2026-06-20T09:00:00'),
      location: 'Richmond Oval, Richmond, BC',
      status: 'draft',
      sportProfileSlug: 'judo', // Key field for multi-sport support
    },
  });

  console.log('  ✅ Created Judo tournament (sportProfileSlug: judo)');

  // Judo weight classes (IJF standard categories, adapted for this demo)
  const judoWeightClasses = [
    // Males
    { name: '-66kg', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 0, weightMaxLbs: 145, displayOrder: 1 },
    { name: '-73kg', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 145, weightMaxLbs: 161, displayOrder: 2 },
    { name: '-81kg', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 161, weightMaxLbs: 179, displayOrder: 3 },
    { name: '+81kg', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 179, weightMaxLbs: 999, displayOrder: 4 },
    // Females
    { name: '-52kg', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 0, weightMaxLbs: 115, displayOrder: 5 },
    { name: '-57kg', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 115, weightMaxLbs: 126, displayOrder: 6 },
    { name: '-63kg', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 126, weightMaxLbs: 139, displayOrder: 7 },
    { name: '+63kg', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 139, weightMaxLbs: 999, displayOrder: 8 },
  ];

  for (const wc of judoWeightClasses) {
    await prisma.weightClass.create({
      data: { id: randomUUID(), tournamentId, ...wc },
    });
  }

  console.log('  ✅ Created Judo-specific weight classes (IJF categories)');

  // Create competitors and registrations
  for (const c of judoCompetitors) {
    const competitorId = randomUUID();
    const registrationId = randomUUID();
    const dob = new Date('2026-06-20');
    dob.setFullYear(dob.getFullYear() - c.age);

    await prisma.competitor.create({
      data: {
        id: competitorId,
        firstName: c.firstName,
        lastName: c.lastName,
        gender: c.gender,
        dateOfBirth: dob,
        belt: c.belt,
        danRank: c.danRank,
        weightLbs: c.weightLbs,
        heightInches: c.heightInches,
        schoolDojang: c.school,
        yearsTraining: c.danRank ? c.danRank * 3 + 2 : Math.floor(c.age / 3),
        region: 'BC',
      },
    });

    await prisma.registration.create({
      data: {
        id: registrationId,
        tournamentId,
        competitorId,
        // Judo focuses on Randori (sparring/shiai)
        patterns: false, // Judo has Kata but it's less common in tournaments
        sparring: true,  // Randori / Shiai
        weightAtRegistration: c.weightLbs,
        ageAtTournament: c.age,
      },
    });
  }

  console.log(`  ✅ Created ${judoCompetitors.length} Judo competitors`);
  console.log('  🎯 Sport-specific: Black Belt (Kyu/Dan ranks) + IJF weight classes\n');
}

// ── Usage Example ────────────────────────────────────────────────────────────

/**
 * To integrate into main seed.ts:
 * 
 * import { seedKarateTournament, seedJudoTournament } from './seed-karate-judo.example';
 * 
 * async function main() {
 *   // ... existing Taekwondo seed ...
 *   
 *   await seedKarateTournament(prisma);
 *   await seedJudoTournament(prisma);
 *   
 *   console.log('✅ Multi-sport seed complete: Taekwondo, Karate, Judo');
 * }
 */

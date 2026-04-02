import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────

function uuid() {
  return randomUUID();
}

function dob(age: number): Date {
  const d = new Date('2026-04-18'); // tournament date
  d.setFullYear(d.getFullYear() - age);
  d.setMonth(d.getMonth() - Math.floor(Math.random() * 6));
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Competitor data ──────────────────────────────────────────────────

interface CompetitorInput {
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  belt: string;
  danRank: number | null;
  weightLbs: number;
  heightInches: number;
  school: string;
}

const schools = [
  'Tiger Martial Arts',
  'Iron Phoenix TKD',
  'Hwarang Academy',
  'Seoul Spirit Dojang',
  'Mountain View TKD',
  'Golden Dragon Academy',
];

const competitors: CompetitorInput[] = [
  // ── BB Males (8) — ages 18-35 sparring division ──
  { firstName: 'Minho',    lastName: 'Kim',        gender: 'M', age: 24, belt: 'Black', danRank: 2, weightLbs: 165, heightInches: 70, school: schools[0] },
  { firstName: 'James',    lastName: 'Rodriguez',   gender: 'M', age: 22, belt: 'Black', danRank: 1, weightLbs: 170, heightInches: 71, school: schools[1] },
  { firstName: 'Seojun',   lastName: 'Park',        gender: 'M', age: 27, belt: 'Black', danRank: 3, weightLbs: 158, heightInches: 69, school: schools[2] },
  { firstName: 'Tyler',    lastName: 'Chen',        gender: 'M', age: 20, belt: 'Black', danRank: 1, weightLbs: 162, heightInches: 68, school: schools[3] },
  { firstName: 'Jiwon',    lastName: 'Lee',         gender: 'M', age: 30, belt: 'Black', danRank: 4, weightLbs: 175, heightInches: 72, school: schools[0] },
  { firstName: 'Marcus',   lastName: 'Thompson',    gender: 'M', age: 25, belt: 'Black', danRank: 2, weightLbs: 168, heightInches: 71, school: schools[4] },
  { firstName: 'Hyunwoo',  lastName: 'Choi',        gender: 'M', age: 23, belt: 'Black', danRank: 1, weightLbs: 155, heightInches: 67, school: schools[5] },
  { firstName: 'David',    lastName: 'Nguyen',      gender: 'M', age: 28, belt: 'Black', danRank: 3, weightLbs: 172, heightInches: 73, school: schools[2] },

  // ── BB Females (8) — ages 18-35 sparring division ──
  { firstName: 'Soyeon',   lastName: 'Yoon',        gender: 'F', age: 21, belt: 'Black', danRank: 1, weightLbs: 125, heightInches: 63, school: schools[0] },
  { firstName: 'Emily',    lastName: 'Watson',      gender: 'F', age: 24, belt: 'Black', danRank: 2, weightLbs: 130, heightInches: 65, school: schools[1] },
  { firstName: 'Jieun',    lastName: 'Han',         gender: 'F', age: 26, belt: 'Black', danRank: 2, weightLbs: 118, heightInches: 62, school: schools[3] },
  { firstName: 'Sophia',   lastName: 'Martinez',    gender: 'F', age: 19, belt: 'Black', danRank: 1, weightLbs: 135, heightInches: 66, school: schools[4] },
  { firstName: 'Minji',    lastName: 'Kang',        gender: 'F', age: 23, belt: 'Black', danRank: 3, weightLbs: 122, heightInches: 64, school: schools[2] },
  { firstName: 'Olivia',   lastName: 'Park',        gender: 'F', age: 22, belt: 'Black', danRank: 1, weightLbs: 128, heightInches: 64, school: schools[5] },
  { firstName: 'Yuna',     lastName: 'Shin',        gender: 'F', age: 25, belt: 'Black', danRank: 2, weightLbs: 120, heightInches: 61, school: schools[0] },
  { firstName: 'Rachel',   lastName: 'Kim',         gender: 'F', age: 20, belt: 'Black', danRank: 1, weightLbs: 132, heightInches: 65, school: schools[3] },

  // ── CB Males (4) — ages 12-14 patterns ──
  { firstName: 'Taeyang',  lastName: 'Lim',         gender: 'M', age: 13, belt: 'Blue',  danRank: null, weightLbs: 105, heightInches: 60, school: schools[1] },
  { firstName: 'Ethan',    lastName: 'Cho',         gender: 'M', age: 14, belt: 'Blue',  danRank: null, weightLbs: 110, heightInches: 62, school: schools[4] },
  { firstName: 'Brandon',  lastName: 'Ryu',         gender: 'M', age: 12, belt: 'Green', danRank: null, weightLbs: 95,  heightInches: 57, school: schools[0] },
  { firstName: 'Dokyun',   lastName: 'Baek',        gender: 'M', age: 13, belt: 'Green', danRank: null, weightLbs: 100, heightInches: 59, school: schools[5] },
];

// ── Main seed function ───────────────────────────────────────────────

async function main() {
  console.log('🥋 Seeding Spring Championship 2026...\n');

  // Clean existing data (order matters for FK constraints)
  await prisma.matchAuditLog.deleteMany();
  await prisma.matchupHistory.deleteMany();
  await prisma.competitorRating.deleteMany();
  await prisma.competitorHistory.deleteMany();
  await prisma.match.deleteMany();
  await prisma.bracket.deleteMany();
  await prisma.divisionAssignment.deleteMany();
  await prisma.division.deleteMany();
  await prisma.weightClass.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.tournament.deleteMany();

  console.log('  Cleared existing data.');

  // ── Tournament ──
  const tournamentId = uuid();
  await prisma.tournament.create({
    data: {
      id: tournamentId,
      name: 'Spring Championship 2026',
      date: new Date('2026-04-18T09:00:00'),
      location: 'Newton Community Centre, Surrey, BC',
      status: 'in_progress',
    },
  });
  console.log('  Created tournament.');

  // ── Weight Classes ──
  const weightClassDefs = [
    { name: 'Feather', gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 0,   weightMaxLbs: 145, displayOrder: 1 },
    { name: 'Light',   gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 145, weightMaxLbs: 165, displayOrder: 2 },
    { name: 'Middle',  gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 165, weightMaxLbs: 180, displayOrder: 3 },
    { name: 'Heavy',   gender: 'M', ageMin: 18, ageMax: 35, weightMinLbs: 180, weightMaxLbs: 999, displayOrder: 4 },
    { name: 'Feather', gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 0,   weightMaxLbs: 115, displayOrder: 5 },
    { name: 'Light',   gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 115, weightMaxLbs: 125, displayOrder: 6 },
    { name: 'Middle',  gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 125, weightMaxLbs: 140, displayOrder: 7 },
    { name: 'Heavy',   gender: 'F', ageMin: 18, ageMax: 35, weightMinLbs: 140, weightMaxLbs: 999, displayOrder: 8 },
  ];

  for (const wc of weightClassDefs) {
    await prisma.weightClass.create({
      data: { id: uuid(), tournamentId, ...wc },
    });
  }
  console.log('  Created weight classes.');

  // ── Competitors & Registrations ──
  const registrationMap: Record<string, string> = {}; // competitorIndex → registrationId

  for (let i = 0; i < competitors.length; i++) {
    const c = competitors[i];
    const competitorId = uuid();
    const registrationId = uuid();
    const beltLevel = c.belt === 'Black' ? 'BB' : 'CB';
    const ageAtTournament = c.age;

    await prisma.competitor.create({
      data: {
        id: competitorId,
        firstName: c.firstName,
        lastName: c.lastName,
        gender: c.gender,
        dateOfBirth: dob(c.age),
        belt: c.belt,
        danRank: c.danRank,
        weightLbs: c.weightLbs,
        heightInches: c.heightInches,
        schoolDojang: c.school,
        yearsTraining: c.danRank ? c.danRank * 3 + 2 : Math.floor(c.age / 4),
        region: 'BC',
      },
    });

    await prisma.registration.create({
      data: {
        id: registrationId,
        tournamentId,
        competitorId,
        patterns: beltLevel === 'CB', // CB kids do patterns
        sparring: beltLevel === 'BB', // BB adults do sparring
        weightAtRegistration: c.weightLbs,
        ageAtTournament,
        checkedIn: true,
        checkInTime: new Date('2026-04-18T08:30:00'),
        checkInWeight: c.weightLbs + (Math.random() * 2 - 1), // slight variance
        heightAtRegistration: c.heightInches,
      },
    });

    registrationMap[i] = registrationId;
  }
  console.log(`  Created ${competitors.length} competitors with registrations.`);

  // ── Divisions ──

  // Division 1: BB Males 18-35 Sparring (Middle weight — indices 0-7)
  const divBBMalesSparring = uuid();
  await prisma.division.create({
    data: {
      id: divBBMalesSparring,
      tournamentId,
      name: '18-35 BB Males Sparring Middle',
      beltLevel: 'BB',
      gender: 'M',
      eventType: 'sparring',
      ageMin: 18,
      ageMax: 35,
      weightClass: 'Middle',
      divisionNumber: 1,
      displayOrder: 1,
    },
  });

  // Division 2: BB Females 18-35 Sparring (Light — indices 8-15)
  const divBBFemalesSparring = uuid();
  await prisma.division.create({
    data: {
      id: divBBFemalesSparring,
      tournamentId,
      name: '18-35 BB Females Sparring Light',
      beltLevel: 'BB',
      gender: 'F',
      eventType: 'sparring',
      ageMin: 18,
      ageMax: 35,
      weightClass: 'Light',
      divisionNumber: 1,
      displayOrder: 2,
    },
  });

  // Division 3: CB Males 12-14 Patterns (indices 16-19)
  const divCBMalesPatterns = uuid();
  await prisma.division.create({
    data: {
      id: divCBMalesPatterns,
      tournamentId,
      name: '12-14 CB Blue/Green Males Patterns',
      beltLevel: 'CB',
      gender: 'M',
      eventType: 'patterns',
      ageMin: 12,
      ageMax: 14,
      beltColors: JSON.stringify(['Blue', 'Green']),
      divisionNumber: 1,
      displayOrder: 3,
    },
  });

  console.log('  Created 3 divisions.');

  // ── Division Assignments ──
  // BB Males (0-7) → div1
  for (let i = 0; i < 8; i++) {
    await prisma.divisionAssignment.create({
      data: {
        id: uuid(),
        divisionId: divBBMalesSparring,
        registrationId: registrationMap[i],
        seedPosition: i + 1,
      },
    });
  }
  // BB Females (8-15) → div2
  for (let i = 8; i < 16; i++) {
    await prisma.divisionAssignment.create({
      data: {
        id: uuid(),
        divisionId: divBBFemalesSparring,
        registrationId: registrationMap[i],
        seedPosition: i - 7,
      },
    });
  }
  // CB Males (16-19) → div3
  for (let i = 16; i < 20; i++) {
    await prisma.divisionAssignment.create({
      data: {
        id: uuid(),
        divisionId: divCBMalesPatterns,
        registrationId: registrationMap[i],
        seedPosition: i - 15,
      },
    });
  }
  console.log('  Assigned competitors to divisions.');

  // ── Bracket & Matches: BB Males 8-person double elim ──
  await createFullBracket(divBBMalesSparring, registrationMap, 0, 8, true);

  // ── Bracket & Matches: BB Females 8-person double elim ──
  await createFullBracket(divBBFemalesSparring, registrationMap, 8, 16, false);

  // ── Bracket & Matches: CB Males 4-person single elim ──
  await createSmallBracket(divCBMalesPatterns, registrationMap, 16, 20);

  console.log('\n✅ Seed complete! Run the app to see the data.\n');
}

// ── Build an 8-person double-elimination bracket ─────────────────────

async function createFullBracket(
  divisionId: string,
  regMap: Record<string, string>,
  startIdx: number,
  endIdx: number,
  withResults: boolean, // true = some matches completed
) {
  const bracketId = uuid();

  // Standard 8-person double-elim layout
  // Winners bracket: R1 (4 matches) → R2 (2 matches) → R3 (1 match)
  // Losers bracket:  L1 (2 matches) → L2 (2 matches) → L3 (1 match) → L4 (1 match)
  // Finals: championship match (+ possible reset)

  const r = (i: number) => regMap[startIdx + i]; // shorthand

  const winnersR1: [number, number][] = [[0,7],[3,4],[1,6],[2,5]]; // 1v8, 4v5, 2v7, 3v6
  const matchData: any[] = [];
  let matchNum = 1;

  // Winners R1 (matches 1-4)
  for (const [a, b] of winnersR1) {
    matchData.push({
      matchNumber: matchNum++,
      round: 1,
      competitor1Id: r(a),
      competitor2Id: r(b),
      bracketType: 'winners',
      nextWinnerMatch: matchNum <= 2 ? 5 : 6, // feed into WR2
      nextLoserMatch: matchNum <= 2 ? 7 : 8,  // feed into LR1
    });
  }

  // Winners R2 (matches 5-6)
  matchData.push({ matchNumber: 5, round: 2, competitor1Id: null, competitor2Id: null, bracketType: 'winners' });
  matchData.push({ matchNumber: 6, round: 2, competitor1Id: null, competitor2Id: null, bracketType: 'winners' });

  // Winners R3 / Winners Final (match 7)
  matchData.push({ matchNumber: 7, round: 3, competitor1Id: null, competitor2Id: null, bracketType: 'winners' });

  // Losers R1 (matches 8-9)
  matchData.push({ matchNumber: 8, round: 1, competitor1Id: null, competitor2Id: null, bracketType: 'losers' });
  matchData.push({ matchNumber: 9, round: 1, competitor1Id: null, competitor2Id: null, bracketType: 'losers' });

  // Losers R2 (matches 10-11)
  matchData.push({ matchNumber: 10, round: 2, competitor1Id: null, competitor2Id: null, bracketType: 'losers' });
  matchData.push({ matchNumber: 11, round: 2, competitor1Id: null, competitor2Id: null, bracketType: 'losers' });

  // Losers R3 (match 12)
  matchData.push({ matchNumber: 12, round: 3, competitor1Id: null, competitor2Id: null, bracketType: 'losers' });

  // Losers Final (match 13)
  matchData.push({ matchNumber: 13, round: 4, competitor1Id: null, competitor2Id: null, bracketType: 'losers' });

  // Grand Finals (match 14)
  matchData.push({ matchNumber: 14, round: 5, competitor1Id: null, competitor2Id: null, bracketType: 'finals' });

  // Build bracket structure JSON
  const structure = {
    winners: matchData.filter(m => m.bracketType === 'winners').map(m => ({
      matchNumber: m.matchNumber,
      round: m.round,
      competitor1Id: m.competitor1Id,
      competitor2Id: m.competitor2Id,
    })),
    losers: matchData.filter(m => m.bracketType === 'losers').map(m => ({
      matchNumber: m.matchNumber,
      round: m.round,
      competitor1Id: m.competitor1Id,
      competitor2Id: m.competitor2Id,
    })),
    finals: matchData.filter(m => m.bracketType === 'finals').map(m => ({
      matchNumber: m.matchNumber,
      round: m.round,
      competitor1Id: m.competitor1Id,
      competitor2Id: m.competitor2Id,
    })),
    competitorCount: endIdx - startIdx,
  };

  await prisma.bracket.create({
    data: {
      id: bracketId,
      divisionId,
      structure: JSON.stringify(structure),
    },
  });

  // Now create Match records
  // If withResults, simulate completed Winners R1 + partially completed R2

  for (const md of matchData) {
    let status = 'pending';
    let c1 = md.competitor1Id;
    let c2 = md.competitor2Id;
    let winnerId: string | null = null;
    let score1: string | null = null;
    let score2: string | null = null;

    if (withResults) {
      // Winners R1: all completed
      if (md.bracketType === 'winners' && md.round === 1) {
        status = 'completed';
        winnerId = c1; // higher seed wins
        score1 = `${8 + Math.floor(Math.random() * 5)}`;
        score2 = `${3 + Math.floor(Math.random() * 5)}`;

        // Advance winner to W-R2
        const wr2Match = md.matchNumber <= 2 ? matchData[4] : matchData[5]; // match 5 or 6
        if (!wr2Match.competitor1Id) wr2Match.competitor1Id = winnerId;
        else wr2Match.competitor2Id = winnerId;

        // Send loser to L-R1
        const loserId = c2;
        const lr1Match = md.matchNumber <= 2 ? matchData[7] : matchData[8]; // match 8 or 9
        if (!lr1Match.competitor1Id) lr1Match.competitor1Id = loserId;
        else lr1Match.competitor2Id = loserId;
      }

      // Winners R2 match 5: completed
      if (md.bracketType === 'winners' && md.round === 2 && md.matchNumber === 5) {
        c1 = md.competitor1Id;
        c2 = md.competitor2Id;
        if (c1 && c2) {
          status = 'completed';
          winnerId = c1;
          score1 = '11';
          score2 = '7';
          // Advance to W-R3
          matchData[6].competitor1Id = winnerId;
          // Loser to L-R2
          matchData[9].competitor2Id = c2;
        }
      }

      // Winners R2 match 6: in_progress
      if (md.bracketType === 'winners' && md.round === 2 && md.matchNumber === 6) {
        c1 = md.competitor1Id;
        c2 = md.competitor2Id;
        if (c1 && c2) {
          status = 'in_progress';
        }
      }

      // Losers R1 match 8: completed
      if (md.bracketType === 'losers' && md.round === 1 && md.matchNumber === 8) {
        c1 = md.competitor1Id;
        c2 = md.competitor2Id;
        if (c1 && c2) {
          status = 'completed';
          winnerId = c2; // upset
          score1 = '5';
          score2 = '9';
          matchData[9].competitor1Id = winnerId;
        }
      }

      // Losers R1 match 9: ready (not started yet)
      if (md.bracketType === 'losers' && md.round === 1 && md.matchNumber === 9) {
        c1 = md.competitor1Id;
        c2 = md.competitor2Id;
        if (c1 && c2) {
          status = 'ready';
        }
      }
    }

    await prisma.match.create({
      data: {
        id: uuid(),
        bracketId,
        roundNumber: md.round,
        matchNumber: md.matchNumber,
        bracketType: md.bracketType,
        competitor1Id: c1,
        competitor2Id: c2,
        winnerId,
        score1,
        score2,
        status,
        ringNumber: md.round === 1 ? (md.matchNumber % 3) + 1 : null,
      },
    });
  }

  const label = withResults ? '(with results)' : '(bracket drawn, no results)';
  console.log(`  Created 8-person bracket ${label} — ${matchData.length} matches.`);
}

// ── Build a 4-person small bracket ───────────────────────────────────

async function createSmallBracket(
  divisionId: string,
  regMap: Record<string, string>,
  startIdx: number,
  endIdx: number,
) {
  const bracketId = uuid();
  const r = (i: number) => regMap[startIdx + i];

  const structure = {
    winners: [
      { matchNumber: 1, round: 1, competitor1Id: r(0), competitor2Id: r(3) },
      { matchNumber: 2, round: 1, competitor1Id: r(1), competitor2Id: r(2) },
      { matchNumber: 3, round: 2, competitor1Id: null,  competitor2Id: null },
    ],
    losers: [],
    finals: [],
    competitorCount: endIdx - startIdx,
  };

  await prisma.bracket.create({
    data: {
      id: bracketId,
      divisionId,
      structure: JSON.stringify(structure),
    },
  });

  // Match 1: completed
  const winner1 = r(0);
  await prisma.match.create({
    data: {
      id: uuid(), bracketId, roundNumber: 1, matchNumber: 1, bracketType: 'winners',
      competitor1Id: r(0), competitor2Id: r(3), winnerId: winner1,
      score1: '7.8', score2: '7.2', status: 'completed', ringNumber: 3,
    },
  });

  // Match 2: pending
  await prisma.match.create({
    data: {
      id: uuid(), bracketId, roundNumber: 1, matchNumber: 2, bracketType: 'winners',
      competitor1Id: r(1), competitor2Id: r(2), status: 'ready', ringNumber: 3,
    },
  });

  // Match 3 (final): pending, one competitor known
  await prisma.match.create({
    data: {
      id: uuid(), bracketId, roundNumber: 2, matchNumber: 3, bracketType: 'winners',
      competitor1Id: winner1, competitor2Id: null, status: 'pending',
    },
  });

  console.log('  Created 4-person bracket (patterns, 1 match completed) — 3 matches.');
}

// ── Run ──────────────────────────────────────────────────────────────

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

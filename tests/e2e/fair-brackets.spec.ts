import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginAsEmail, loginRequestAsEmail, skipOnboardingTour } from './helpers';

// Bracket rules are used when brackets are generated: team-mates are kept
// apart in round 1, and the Divisions page / bracket editor say how many
// first-round fights between team-mates are left.

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const directorEmail = 'e2e-fair-brackets-director@example.com';
const ids = {
  organization: '00000000-0000-4000-8000-00000000fb01',
  tournament: '00000000-0000-4000-8000-00000000fb02',
  sparring: '00000000-0000-4000-8000-00000000fb03',
  patterns: '00000000-0000-4000-8000-00000000fb04',
  // 8 sparring (4 + 4 from two schools), 3 patterns (one school).
  competitors: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000fb1${i.toString(16).padStart(2, '0')}`),
};

async function cleanup() {
  const matchIds = (await prisma.match.findMany({ where: { bracket: { division: { tournamentId: ids.tournament } } }, select: { id: true } })).map((m) => m.id);
  await prisma.matchAuditLog.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.matchupHistory.deleteMany({ where: { tournamentId: ids.tournament } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.bracket.deleteMany({ where: { division: { tournamentId: ids.tournament } } });
  await prisma.tournament.deleteMany({ where: { id: ids.tournament } });
  await prisma.organization.deleteMany({ where: { id: ids.organization } });
  await prisma.competitor.deleteMany({ where: { id: { in: ids.competitors } } });
  await prisma.user.deleteMany({ where: { email: directorEmail } });
}

test.beforeAll(async () => {
  await cleanup();
  const director = await prisma.user.create({ data: { email: directorEmail, firstName: 'E2E Fair', lastName: 'Director', role: 'director', isActive: true } });
  await prisma.organization.create({ data: { id: ids.organization, name: 'E2E Fair brackets', slug: 'e2e-fair-brackets' } });
  await prisma.organizationMember.create({ data: { organizationId: ids.organization, userId: director.id, role: 'member' } });
  await prisma.competitor.createMany({
    data: ids.competitors.map((id, i) => ({
      id,
      firstName: `E2E Fair ${i + 1}`,
      lastName: 'Athlete',
      gender: 'M',
      dateOfBirth: new Date('2012-01-01'),
      // The host school's four are the most senior, so "similar strength"
      // pairing (1 v 2, 3 v 4) would put team-mates together.
      belt: i < 4 ? 'Black' : 'Blue',
      danRank: i < 4 ? 4 - i : null,
      schoolDojang: i < 4 ? 'E2E Newtons TKD' : i < 8 ? 'E2E Tiger Dojang' : 'E2E Solo Dojang',
      organizationId: ids.organization,
    })),
  });
  await prisma.tournament.create({
    data: {
      id: ids.tournament,
      organizationId: ids.organization,
      name: 'E2E Fair brackets',
      date: new Date('2030-01-01'),
      status: 'registration',
      settings: JSON.stringify({ brackets: { applySeedingRules: true, avoidSameSchoolRound1: true, round1Pairing: 'adjacent', seedingStrategy: 'belt', byePlacement: 'rating' } }),
      registrations: {
        create: ids.competitors.map((competitorId, i) => ({ competitorId, sparring: i < 8, patterns: i >= 8 })),
      },
    },
  });
  const registrations = await prisma.registration.findMany({ where: { tournamentId: ids.tournament }, include: { competitor: true } });
  const sparringRegs = registrations.filter((r) => r.sparring);
  const patternRegs = registrations.filter((r) => r.patterns);
  await prisma.division.create({ data: { id: ids.sparring, tournamentId: ids.tournament, name: 'E2E Fair Sparring', beltLevel: 'CB', gender: 'M', eventType: 'sparring', ageMin: 10, ageMax: 20, assignments: { create: sparringRegs.map((r, i) => ({ registrationId: r.id, seedPosition: i + 1 })) } } });
  await prisma.division.create({ data: { id: ids.patterns, tournamentId: ids.tournament, name: 'E2E Fair Patterns', beltLevel: 'CB', gender: 'M', eventType: 'patterns', ageMin: 10, ageMax: 20, assignments: { create: patternRegs.map((r, i) => ({ registrationId: r.id, seedPosition: i + 1 })) } } });
});

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

test('generated brackets keep team-mates apart and report what is left', async ({ page, request }) => {
  const headers = await loginRequestAsEmail(request, directorEmail);
  const generated = await request.post(`/api/brackets/tournament/${ids.tournament}/generate-all`, { headers, data: { seedingStrategy: 'school_spread' } });
  expect(generated.status()).toBe(200);
  await expect(generated.json()).resolves.toMatchObject({ generated: 2, errors: [] });

  // 8 people from two schools: no team-mates meet in round 1.
  const sparring = await request.get(`/api/brackets/division/${ids.sparring}`, { headers });
  const sparringBody = await sparring.json();
  expect(sparringBody.sameSchoolFirstRound).toMatchObject({ count: 0, fights: 4, unavoidable: 0 });
  // Seeded by belt: the top seed (4th dan) does not meet the 3rd dan first.
  const topSeed = ids.competitors[0];
  const regOf = new Map((await prisma.registration.findMany({ where: { tournamentId: ids.tournament } })).map((r) => [r.competitorId, r.id]));
  const firstMatch = sparringBody.matches.find((m: { roundNumber: number; bracketType: string; matchNumber: number }) => m.roundNumber === 1 && m.bracketType === 'winners' && m.matchNumber === 1);
  expect([firstMatch.competitor1Id, firstMatch.competitor2Id]).toContain(regOf.get(topSeed));
  expect([firstMatch.competitor1Id, firstMatch.competitor2Id]).not.toContain(regOf.get(ids.competitors[1]));

  // 3 people from one school: the one fight cannot be avoided.
  const patterns = await (await request.get(`/api/brackets/division/${ids.patterns}`, { headers })).json();
  expect(patterns.sameSchoolFirstRound).toMatchObject({ count: 1, fights: 1, unavoidable: 1 });

  const summary = await (await request.get(`/api/brackets/tournament/${ids.tournament}/same-school-first-round`, { headers })).json();
  expect(summary.total).toBe(1);

  await skipOnboardingTour(page);
  await loginAsEmail(page, directorEmail);
  await page.goto(`/tournaments/${ids.tournament}/divisions`);
  await expect(page.getByTestId('same-school-total')).toHaveText('1 first-round fight between team-mates across all brackets. Open a bracket to see which ones.');
  await expect(page.getByText('1 first-round fight between team-mates', { exact: true })).toBeVisible();

  await page.goto(`/tournaments/${ids.tournament}/divisions/${ids.patterns}/bracket`);
  await expect(page.getByTestId('same-school-bracket')).toContainText('1 first-round fight between team-mates');
  await expect(page.getByTestId('same-school-bracket')).toContainText('One school has too many people here');

  await page.goto(`/tournaments/${ids.tournament}/divisions/${ids.sparring}/bracket`);
  await expect(page.getByTestId('same-school-bracket')).toHaveText('No first-round fights between team-mates.');
});

test('bracket rules are labelled in plain words and save', async ({ page }) => {
  await skipOnboardingTour(page);
  await loginAsEmail(page, directorEmail);
  await page.goto(`/tournaments/${ids.tournament}/settings`);
  await page.getByRole('tab', { name: /Categorization \+ Brackets/ }).click();
  const useRules = page.getByRole('switch', { name: /Use these bracket rules when brackets are made/ });
  const keepApart = page.getByRole('checkbox', { name: /Keep team-mates apart in round 1/ });
  await expect(useRules).toBeChecked();
  await expect(keepApart).toBeChecked();
  await expect(page.getByText('Consolation rounds')).toHaveCount(0);
  // Switched off, the choices stay visible but cannot be changed.
  await useRules.uncheck();
  await expect(page.getByTestId('bracket-rules-off-hint')).toBeVisible();
  await expect(page.getByLabel('Round 1 pairing')).toBeDisabled();
  await expect(keepApart).toBeDisabled();
  await useRules.check();
  await expect(page.getByLabel('Round 1 pairing')).toBeEnabled();
  await page.getByLabel('Round 1 pairing').selectOption('balanced');
  await page.getByLabel(/Who gets a bye/).selectOption('random');
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tournaments/${ids.tournament}/rules`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save Rules' }).click();
  expect((await saved).status()).toBe(200);
  const stored = JSON.parse((await prisma.tournament.findUniqueOrThrow({ where: { id: ids.tournament } })).settings ?? '{}');
  expect(stored.brackets).toMatchObject({ applySeedingRules: true, round1Pairing: 'balanced', byePlacement: 'random', avoidSameSchoolRound1: true });
});

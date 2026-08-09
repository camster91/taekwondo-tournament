import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateBracket, type CompetitorSeed } from '../src/server/services/bracket-generator.js';

export const DEMO_ORGANIZATION_SLUG = 'bowin-showcase-demo';
export const DEMO_MARKER = 'bowin-resettable-showcase-v1';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const organizationId = id(1);
const openTournamentId = id(2);
const liveTournamentId = id(3);

const people = [
  ['Ji-eun', '김', 'F', 'Black', 126, 'Hwarang Academy'],
  ['Mateo', 'García', 'M', 'Black', 154, 'North Star Taekwondo'],
  ['Amina', 'Diallo', 'F', 'Blue', 112, 'Maple Leaf Dojang'],
  ['Noah', 'Chen', 'M', 'Red', 138, 'Seoul Spirit Martial Arts'],
  ['Sofía', 'Martínez', 'F', 'Black', 121, 'Hwarang Academy'],
  ['Min-jun', '박', 'M', 'Black', 160, 'North Star Taekwondo'],
  ['Élodie', 'Roy', 'F', 'Blue', 108, 'Maple Leaf Dojang'],
  ['Omar', 'Haddad', 'M', 'Red', 143, 'Seoul Spirit Martial Arts'],
] as const;

type Fixture = ReturnType<typeof buildShowcaseFixture>;
type DemoClient = Pick<PrismaClient, '$transaction' | 'organization'>;

export function buildShowcaseFixture() {
  const organization = {
    id: organizationId,
    name: 'Bowin Showcase Dojangs (Fabricated)',
    slug: DEMO_ORGANIZATION_SLUG,
    plan: 'pro',
    settings: JSON.stringify({ marker: DEMO_MARKER, fabricated: true, resettable: true }),
  };
  const tournaments = [
    {
      id: openTournamentId, organizationId, name: 'Future Stars Open Registration (Demo)',
      date: new Date('2027-05-15T13:00:00.000Z'), location: 'Demo Community Centre',
      status: 'registration', publicSlug: 'bowin-demo-open-registration',
      settings: JSON.stringify({ fabricated: true, registrationCloses: '2027-05-01' }),
    },
    {
      id: liveTournamentId, organizationId, name: 'Bowin Live Championship (Demo)',
      date: new Date('2027-04-18T13:00:00.000Z'), location: 'Demo Performance Hall',
      status: 'in_progress', publicSlug: 'bowin-demo-live-championship',
      settings: JSON.stringify({ fabricated: true, rings: 4, parentScoreboard: true }),
    },
  ];
  const competitors = people.map((p, index) => ({
    id: id(100 + index), firstName: p[0], lastName: p[1], gender: p[2],
    dateOfBirth: new Date(`200${index % 4}-0${(index % 8) + 1}-15T00:00:00.000Z`),
    belt: p[3], danRank: p[3] === 'Black' ? 1 + (index % 2) : null,
    weightLbs: p[4], heightInches: 62 + index, schoolDojang: p[5], region: 'Demo Region',
  }));
  const registrations = competitors.flatMap((competitor, index) => [
    {
      id: id(200 + index), tournamentId: liveTournamentId, competitorId: competitor.id,
      patterns: index >= 4, sparring: index < 4, checkedIn: index % 3 !== 0,
      checkInTime: index % 3 !== 0 ? new Date('2027-04-18T12:00:00.000Z') : null,
      ageAtTournament: 18 + index, parentName: `Demo Guardian ${index + 1}`,
      privacyAccepted: true, rulesAccepted: true, guardianAttested: true,
    },
    {
      id: id(220 + index), tournamentId: openTournamentId, competitorId: competitor.id,
      patterns: true, sparring: index % 2 === 0, checkedIn: false,
      ageAtTournament: 18 + index, parentName: `Demo Guardian ${index + 1}`,
      privacyAccepted: true, rulesAccepted: true, guardianAttested: true,
    },
  ]);
  const divisions = [
    { id: id(300), tournamentId: liveTournamentId, name: 'Demo Black Belt Sparring', beltLevel: 'BB', gender: 'M', eventType: 'sparring', ageMin: 18, ageMax: 35, divisionNumber: 1, displayOrder: 1 },
    { id: id(301), tournamentId: liveTournamentId, name: 'Demo Colour Belt Patterns', beltLevel: 'CB', gender: 'F', eventType: 'patterns', ageMin: 18, ageMax: 35, divisionNumber: 1, displayOrder: 2 },
  ];
  const groups = [registrations.filter((r) => r.tournamentId === liveTournamentId).slice(0, 4), registrations.filter((r) => r.tournamentId === liveTournamentId).slice(4, 8)];
  const assignments = groups.flatMap((group, groupIndex) => group.map((registration, index) => ({ id: id(320 + groupIndex * 4 + index), divisionId: divisions[groupIndex].id, registrationId: registration.id, seedPosition: index + 1 })));
  const brackets: Array<{ id: string; divisionId: string; structure: string; format: string }> = [];
  const matches: Array<Record<string, unknown>> = [];
  groups.forEach((group, groupIndex) => {
    const seeds: CompetitorSeed[] = group.map((registration, index) => ({ registrationId: registration.id, name: `${competitors[groupIndex * 4 + index].firstName} ${competitors[groupIndex * 4 + index].lastName}`, school: competitors[groupIndex * 4 + index].schoolDojang ?? '', seedPosition: index + 1 }));
    const structure = generateBracket(seeds, 'manual');
    const bracketId = id(350 + groupIndex);
    brackets.push({ id: bracketId, divisionId: divisions[groupIndex].id, structure: JSON.stringify(structure), format: 'double_elim' });
    [...structure.winners.map((m) => ({ ...m, bracketType: 'winners' })), ...structure.losers.map((m) => ({ ...m, bracketType: 'losers' })), ...structure.finals.map((m) => ({ ...m, bracketType: 'finals' }))].forEach((match, index) => {
      const statuses = ['completed', 'in_progress', 'ready', 'pending'] as const;
      const status = statuses[(groupIndex * 2 + index) % statuses.length];
      const hasPair = Boolean(match.competitor1Id && match.competitor2Id);
      matches.push({
        id: id(400 + matches.length), bracketId, roundNumber: match.round, matchNumber: match.matchNumber,
        bracketType: match.bracketType, competitor1Id: match.competitor1Id, competitor2Id: match.competitor2Id,
        winnerId: status === 'completed' && hasPair ? match.competitor1Id : null,
        score1: status === 'completed' && hasPair ? '8' : null, score2: status === 'completed' && hasPair ? '5' : null,
        status, ringNumber: (matches.length % 4) + 1,
        scheduledTime: new Date(`2027-04-18T${14 + Math.floor(matches.length / 4)}:${(matches.length % 4) * 10}:00.000Z`),
      });
    });
  });
  const completed = matches.find((match) => match.status === 'completed' && match.winnerId);
  const competitorHistories = completed ? [{
    id: id(500), competitorId: registrations.find((r) => r.id === completed.winnerId)?.competitorId ?? competitors[0].id,
    tournamentId: liveTournamentId, divisionId: divisions[0].id, divisionName: divisions[0].name,
    eventType: 'sparring', placement: 1, matchesWon: 1, matchesLost: 0, points: 10,
  }] : [];
  return { organization, tournaments, competitors, registrations, divisions, assignments, brackets, matches, competitorHistories };
}

function hasDemoMarker(settings: string | null): boolean {
  try { return JSON.parse(settings ?? '{}').marker === DEMO_MARKER; } catch { return false; }
}

async function writeFixture(tx: Prisma.TransactionClient, fixture: Fixture) {
  await tx.organization.create({ data: fixture.organization });
  await tx.tournament.createMany({ data: fixture.tournaments });
  await tx.competitor.createMany({ data: fixture.competitors });
  await tx.registration.createMany({ data: fixture.registrations });
  await tx.division.createMany({ data: fixture.divisions });
  await tx.divisionAssignment.createMany({ data: fixture.assignments });
  await tx.bracket.createMany({ data: fixture.brackets });
  await tx.match.createMany({ data: fixture.matches as Prisma.MatchCreateManyInput[] });
  await tx.competitorHistory.createMany({ data: fixture.competitorHistories });
}

export async function resetDemoShowcase(client: DemoClient): Promise<Fixture> {
  const existing = await client.organization.findUnique({ where: { slug: DEMO_ORGANIZATION_SLUG }, select: { id: true, settings: true } });
  if (existing && !hasDemoMarker(existing.settings)) throw new Error(`Refusing to reset organization '${DEMO_ORGANIZATION_SLUG}': demo marker is missing`);
  const fixture = buildShowcaseFixture();
  await client.$transaction(async (tx) => {
    const current = await tx.organization.findUnique({ where: { slug: DEMO_ORGANIZATION_SLUG }, select: { id: true, settings: true } });
    if (current && !hasDemoMarker(current.settings)) throw new Error(`Refusing to reset organization '${DEMO_ORGANIZATION_SLUG}': demo marker changed`);
    const captured = current ? await tx.registration.findMany({ where: { tournament: { organizationId: current.id } }, select: { competitorId: true }, distinct: ['competitorId'] }) : [];
    if (current) await tx.organization.delete({ where: { id: current.id } });
    if (captured.length) await tx.competitor.deleteMany({ where: { id: { in: captured.map((row) => row.competitorId) }, registrations: { none: {} } } });
    await writeFixture(tx, fixture);
  });
  return fixture;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: ['warn', 'error'] });
  try { const fixture = await resetDemoShowcase(client); console.log(`Reset ${fixture.organization.name}: ${fixture.tournaments.length} tournaments, ${fixture.competitors.length} fabricated competitors.`); }
  finally { await client.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

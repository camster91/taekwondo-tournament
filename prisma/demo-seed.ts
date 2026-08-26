import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateBracket, type CompetitorSeed } from '../src/server/services/bracket-generator.js';

export const DEMO_ORGANIZATION_SLUG = 'bowin-showcase-demo';
export const DEMO_MARKER = 'bowin-resettable-showcase-v1';

export function assertDemoResetAuthorized(env: Record<string, string | undefined>): void {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.DEMO_ISOLATED_DATA !== '1') {
    throw new Error('Demo reset requires an isolated synthetic-data database');
  }
  if (env.DEMO_RESET_CONFIRM !== DEMO_MARKER) {
    throw new Error(`Demo reset attestation must equal ${DEMO_MARKER}`);
  }
}

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const organizationId = id(1);
const openTournamentId = id(2);
const liveTournamentId = id(3);

export function assertSafeDemoDatabaseUrl(value: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('DEMO_DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('DEMO_DATABASE_URL must use a local localhost or 127.0.0.1 database');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_test') && !databaseName.endsWith('_e2e')) {
    throw new Error('DEMO_DATABASE_URL database name must end in _test or _e2e');
  }
}

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
type ShowcaseMatchStatus = 'completed' | 'in_progress' | 'ready' | 'pending';

export function buildShowcaseFixture(now: Date = new Date()) {
  const dayAnchor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (dayOffset: number, hour: number) => new Date(dayAnchor + dayOffset * 86_400_000 + hour * 3_600_000);
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
      date: at(30, 9), location: 'Demo Community Centre',
      status: 'registration', publicSlug: 'bowin-demo-open-registration',
      settings: JSON.stringify({ fabricated: true, registrationCloses: at(23, 0).toISOString().slice(0, 10) }),
    },
    {
      id: liveTournamentId, organizationId, name: 'Bowin Live Championship (Demo)',
      date: at(0, 9), location: 'Demo Performance Hall',
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
      checkInTime: index % 3 !== 0 ? at(0, 8) : null,
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
  const scheduleBase = at(0, 14);
  groups.forEach((group, groupIndex) => {
    const seeds: CompetitorSeed[] = group.map((registration, index) => ({ registrationId: registration.id, name: `${competitors[groupIndex * 4 + index].firstName} ${competitors[groupIndex * 4 + index].lastName}`, school: competitors[groupIndex * 4 + index].schoolDojang ?? '', seedPosition: index + 1 }));
    const structure = generateBracket(seeds, 'manual');
    const bracketId = id(350 + groupIndex);
    brackets.push({ id: bracketId, divisionId: divisions[groupIndex].id, structure: JSON.stringify(structure), format: 'double_elim' });
    [...structure.winners.map((m) => ({ ...m, bracketType: 'winners' })), ...structure.losers.map((m) => ({ ...m, bracketType: 'losers' })), ...structure.finals.map((m) => ({ ...m, bracketType: 'finals' }))].forEach((match, index) => {
      let status: ShowcaseMatchStatus = 'pending';
      let competitor1Id = match.competitor1Id;
      let competitor2Id = match.competitor2Id;
      let winnerId: string | null = null;
      let score1: string | null = null;
      let score2: string | null = null;
      if (groupIndex === 0) {
        const [r1, r2, r3, r4] = group.map((registration) => registration.id);
        const completedProgression: Record<number, [string, string, string]> = {
          1: [r1, r4, r1], 2: [r2, r3, r2], 3: [r1, r2, r1],
          4: [r4, r3, r3], 5: [r3, r2, r2], 6: [r1, r2, r1],
        };
        const result = completedProgression[match.matchNumber];
        if (result) {
          [competitor1Id, competitor2Id, winnerId] = result;
          status = 'completed';
          score1 = '8';
          score2 = '5';
        } else {
          competitor1Id = null;
          competitor2Id = null;
          status = 'pending';
        }
      } else {
        const [r1, r2, r3, r4] = group.map((registration) => registration.id);
        const states: Record<number, { status: ShowcaseMatchStatus; slots: [string | null, string | null]; winner?: string }> = {
          1: { status: 'completed', slots: [r1, r4], winner: r1 },
          2: { status: 'completed', slots: [r2, r3], winner: r2 },
          3: { status: 'in_progress', slots: [r1, r2] },
          4: { status: 'ready', slots: [r4, r3] },
          5: { status: 'pending', slots: [null, null] },
          6: { status: 'pending', slots: [null, null] },
          7: { status: 'pending', slots: [null, null] },
        };
        const state = states[match.matchNumber];
        status = state.status;
        [competitor1Id, competitor2Id] = state.slots;
        winnerId = state.winner ?? null;
        if (status === 'completed') {
          score1 = '8';
          score2 = '5';
        }
      }
      const isScheduled = status !== 'pending';
      matches.push({
        id: id(400 + matches.length), bracketId, roundNumber: match.round, matchNumber: match.matchNumber,
        bracketType: match.bracketType, competitor1Id, competitor2Id,
        winnerId, score1, score2, status,
        ringNumber: isScheduled ? (matches.length % 4) + 1 : null,
        scheduledTime: isScheduled ? new Date(scheduleBase.getTime() + matches.length * 10 * 60_000) : null,
      });
    });
  });
  const completed = matches.find((match) => match.status === 'completed' && match.winnerId);
  const competitorHistories = completed ? [{
    id: id(500), competitorId: registrations.find((r) => r.id === completed.winnerId)?.competitorId ?? competitors[0].id,
    tournamentId: liveTournamentId, divisionId: divisions[0].id, divisionName: divisions[0].name,
    eventType: 'sparring', placement: 1, matchesWon: 3, matchesLost: 0, points: 10,
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
  const fixture = buildShowcaseFixture(new Date());
  await client.$transaction(async (tx) => {
    const current = await tx.organization.findUnique({ where: { slug: DEMO_ORGANIZATION_SLUG }, select: { id: true, settings: true } });
    if (current && !hasDemoMarker(current.settings)) throw new Error(`Refusing to reset organization '${DEMO_ORGANIZATION_SLUG}': demo marker changed`);
    const captured = current ? await tx.registration.findMany({ where: { tournament: { organizationId: current.id } }, select: { competitorId: true }, distinct: ['competitorId'] }) : [];
    if (current) {
      // Delete leaf match rows explicitly. Some deployed PostgreSQL
      // databases have not applied the expected multi-level cascade
      // ordering, so relying on Tournament -> Division -> Bracket ->
      // Match can fail even though the current schema declares the
      // intermediate cascades.
      await tx.match.deleteMany({
        where: { bracket: { division: { tournament: { organizationId: current.id } } } },
      });
      // Tournament.organization intentionally has no database-level
      // ON DELETE CASCADE, so remove only this verified demo tenant's
      // tournaments before its organization. Tournament-owned records
      // cascade through their own foreign keys.
      await tx.tournament.deleteMany({ where: { organizationId: current.id } });
      await tx.organization.delete({ where: { id: current.id, settings: current.settings } });
    }
    if (captured.length) await tx.competitor.deleteMany({ where: { id: { in: captured.map((row) => row.competitorId) }, registrations: { none: {} } } });
    await writeFixture(tx, fixture);
  });
  return fixture;
}

async function main() {
  assertDemoResetAuthorized(process.env);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: ['warn', 'error'] });
  try { const fixture = await resetDemoShowcase(client); console.log(`Reset ${fixture.organization.name}: ${fixture.tournaments.length} tournaments, ${fixture.competitors.length} fabricated competitors.`); }
  finally { await client.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

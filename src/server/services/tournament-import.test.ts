import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  competitorMatchesRow,
  isEventMarked,
  missingImportColumns,
  planTournamentImport,
  prepareTournamentImportRows,
  tournamentCompetitorScope,
  type ImportTournament,
  type MatchCandidate,
} from './tournament-import.js';
import { detectEventColumns, readUploadedWorkbook, resolveImportSheet, sheetRowsForImport } from './excel-auto-map.js';
import { generateImportTemplate, TEMPLATE_COLUMNS } from './excel-template.js';
import type { ColumnMapping, ExcelRow } from './excel-import.js';

const MAPPING: Partial<ColumnMapping> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  gender: 'Gender',
  dateOfBirth: 'Date of Birth',
  belt: 'Belt',
  weight: 'Weight (lbs)',
  school: 'School/Dojang',
  patterns: 'Patterns',
  sparring: 'Sparring',
};

const row = (first: string, last: string, patterns: unknown, sparring: unknown, extra: Partial<ExcelRow> = {}): ExcelRow => ({
  'First Name': first,
  'Last Name': last,
  Gender: 'F',
  'Date of Birth': '2014-05-02',
  Belt: 'Green',
  'Weight (lbs)': 72,
  'School/Dojang': 'Tiger TKD',
  Patterns: patterns as ExcelRow[string],
  Sparring: sparring as ExcelRow[string],
  ...extra,
});

describe('isEventMarked', () => {
  it.each(['Y', 'y', 'Yes', 'YES', ' x ', 'X', '1', 'true', '✓', 1, true])('treats %j as entered', (v) => {
    expect(isEventMarked(v)).toBe(true);
  });
  it.each(['', 'N', 'no', '0', 0, 2, false, null, undefined, 'maybe'])('treats %j as not entered', (v) => {
    expect(isEventMarked(v as never)).toBe(false);
  });
});

describe('missingImportColumns', () => {
  it('needs a name, gender, birth date or age, belt and one event column', () => {
    expect(missingImportColumns(MAPPING)).toEqual([]);
    expect(missingImportColumns({ name: 'Name', gender: 'G', age: 'Age', belt: 'B', sparring: 'S' })).toEqual([]);
    expect(missingImportColumns({})).toEqual([
      'First and last name (or one name column)',
      'Gender',
      'Date of birth (or age)',
      'Belt',
      'At least one event column',
    ]);
  });
  it('does not need a weight column', () => {
    const { weight: _w, ...noWeight } = MAPPING;
    expect(missingImportColumns(noWeight)).toEqual([]);
  });
});

describe('prepareTournamentImportRows', () => {
  it('reads Y/Yes/X/1 per event and skips rows with no event, bad data or repeats', () => {
    const rows = [
      row('Ava', 'Lee', 'Y', ''),
      row('Ben', 'Lee', '', 'yes'),
      row('Cy', 'Lee', 'x', '1'),
      row('Di', 'Lee', '', ''),
      row('Ed', 'Lee', 'Y', '', { Gender: '?' }),
      row('AVA', 'LEE', '', 'Y'),
    ];
    const { rows: ready, skipped } = prepareTournamentImportRows(rows, MAPPING);
    expect(ready.map((r) => [r.firstName, r.patterns, r.sparring])).toEqual([
      ['Ava', true, false],
      ['Ben', false, true],
      ['Cy', true, true],
    ]);
    expect(skipped).toEqual([
      { row: 5, name: 'Di Lee', reason: 'No event marked' },
      { row: 6, name: null, reason: 'Invalid gender: ?' },
      { row: 7, name: 'AVA LEE', reason: 'Same person as row 2' },
    ]);
  });

  it('only reads the event columns that are mapped', () => {
    const { rows: ready } = prepareTournamentImportRows([row('Ava', 'Lee', 'Y', 'Y')], { ...MAPPING, sparring: undefined });
    expect(ready[0]).toMatchObject({ patterns: true, sparring: false });
  });

  it('reads the filled-in import template, including its event columns', () => {
    const workbook = XLSX.read(generateImportTemplate(), { type: 'buffer' });
    expect(TEMPLATE_COLUMNS.map((c) => c.header)).toEqual(expect.arrayContaining(['Patterns', 'Sparring']));
    XLSX.utils.sheet_add_aoa(workbook.Sheets.Competitors, [
      ['Ava', 'Lee', 'F', '2014-05-02', 'Green', '', 72, '', 'Tiger TKD', 'Y', '', ''],
      ['Ben', 'Lee', 'M', '2012-01-20', 'Blue', '', 90, '', 'Tiger TKD', '', 'X', ''],
    ], { origin: 'A2' });
    const parsed = readUploadedWorkbook(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const { sheetName, headerRow } = resolveImportSheet(parsed);
    expect(sheetName).toBe('Competitors');
    const { rows: ready, skipped } = prepareTournamentImportRows(sheetRowsForImport(parsed, sheetName, headerRow), MAPPING);
    expect(skipped).toEqual([]);
    expect(ready.map((r) => [r.firstName, r.patterns, r.sparring, r.weightLbs])).toEqual([
      ['Ava', true, false, 72],
      ['Ben', false, true, 90],
    ]);
  });
});

describe('detectEventColumns', () => {
  it('finds the Taekwondo columns, including "(Y/N)" style headings', () => {
    expect(detectEventColumns(['Name', 'Patterns (Y/N)', 'Sparring?'], 'taekwondo')).toEqual({
      patterns: 'Patterns (Y/N)',
      sparring: 'Sparring?',
    });
  });

  it('uses the sport event names (Karate kata / kumite)', () => {
    expect(detectEventColumns(['First Name', 'Kumite', 'Kata'], 'karate')).toEqual({ patterns: 'Kata', sparring: 'Kumite' });
  });

  it('follows the slot order, not the event type (Judo stores Randori in the first slot)', () => {
    expect(detectEventColumns(['Kata', 'Randori'], 'judo')).toEqual({ patterns: 'Randori', sparring: 'Kata' });
    expect(detectEventColumns(['Forms', 'Sparring'], 'judo')).toEqual({ patterns: 'Sparring', sparring: 'Forms' });
  });

  it('accepts generic words for each kind of event', () => {
    expect(detectEventColumns(['Forms', 'Kyorugi'], 'taekwondo')).toEqual({ patterns: 'Forms', sparring: 'Kyorugi' });
  });

  it('ignores headers already used and partial words', () => {
    expect(detectEventColumns(['Formal Name', 'Notes'], 'taekwondo')).toEqual({});
    expect(detectEventColumns(['Patterns', 'Sparring'], 'taekwondo', ['Patterns'])).toEqual({ sparring: 'Sparring' });
  });

  it('only looks for the slots a sport has', () => {
    expect(detectEventColumns(['Bout', 'Sparring'], 'boxing')).toEqual({ patterns: 'Bout' });
  });
});

describe('competitorMatchesRow', () => {
  const [ready] = prepareTournamentImportRows([row('Ava', 'Lee', 'Y', '')], MAPPING).rows;
  const candidate: MatchCandidate = {
    id: 'c1', firstName: 'AVA', lastName: 'lee', dateOfBirth: new Date(Date.UTC(2014, 4, 2)), schoolDojang: null, weightLbs: 70,
  };

  it('matches name in any case plus the exact birth date', () => {
    expect(competitorMatchesRow(candidate, ready)).toBe(true);
    expect(competitorMatchesRow({ ...candidate, dateOfBirth: new Date(Date.UTC(2014, 4, 3)) }, ready)).toBe(false);
    expect(competitorMatchesRow({ ...candidate, lastName: 'Li' }, ready)).toBe(false);
  });

  it('matches age-only rows on name, school and a nearby birth year', () => {
    const ageMapping = { ...MAPPING, dateOfBirth: undefined, age: 'Age' };
    const [aged] = prepareTournamentImportRows([row('Ava', 'Lee', 'Y', '', { Age: 10 })], ageMapping).rows;
    const year = aged.syntheticBirthYear!;
    const near = { ...candidate, dateOfBirth: new Date(Date.UTC(year - 1, 6, 1)), schoolDojang: 'TIGER tkd' };
    expect(competitorMatchesRow(near, aged)).toBe(true);
    expect(competitorMatchesRow({ ...near, schoolDojang: 'Other' }, aged)).toBe(false);
    expect(competitorMatchesRow({ ...near, dateOfBirth: new Date(Date.UTC(year - 3, 0, 1)) }, aged)).toBe(false);
  });
});

describe('tournamentCompetitorScope', () => {
  it('keeps organization tournaments to that organization', () => {
    expect(tournamentCompetitorScope('org-1')).toEqual({
      registrations: { every: { tournament: { organizationId: 'org-1' } } },
      OR: [{ organizationId: 'org-1' }, { registrations: { some: { tournament: { organizationId: 'org-1' } } } }],
    });
  });
  it('keeps org-less tournaments to org-less competitors', () => {
    expect(tournamentCompetitorScope(null)).toEqual({
      organizationId: null,
      registrations: { every: { tournament: { organizationId: null } } },
    });
  });
});

/** Minimal in-memory stand-in for the queries planTournamentImport makes. */
function fakeDb(options: {
  competitors?: MatchCandidate[];
  registrations?: Array<{ id: string; competitorId: string; patterns: boolean; sparring: boolean; waitlistStatus: string; waitlistPosition?: number | null }>;
}) {
  const registrations = options.registrations ?? [];
  return {
    competitor: {
      findMany: async () => options.competitors ?? [],
    },
    registration: {
      findMany: async ({ where }: { where: { competitorId: { in: string[] } } }) =>
        registrations.filter((r) => where.competitorId.in.includes(r.competitorId)),
      count: async ({ where }: { where: { waitlistStatus?: { in: string[] } } }) =>
        registrations.filter((r) => !where.waitlistStatus || where.waitlistStatus.in.includes(r.waitlistStatus)).length,
      findFirst: async () => {
        const positions = registrations.filter((r) => r.waitlistStatus === 'waitlisted').map((r) => r.waitlistPosition ?? 0);
        return positions.length ? { waitlistPosition: Math.max(...positions) } : null;
      },
    },
  } as unknown as PrismaClient;
}

const TOURNAMENT: ImportTournament = {
  id: 't1', date: new Date('2026-11-01T12:00:00Z'), organizationId: null, maxCapacity: null, waitlistEnabled: false, plan: 'pro',
};

describe('planTournamentImport', () => {
  const prepared = prepareTournamentImportRows([
    row('Ava', 'Lee', 'Y', ''),
    row('Ben', 'Lee', 'Y', 'Y'),
    row('Cy', 'Lee', '', 'Y'),
  ], MAPPING);

  it('counts new and matched competitors and leaves existing details alone', async () => {
    const ava: MatchCandidate = { id: 'ava', firstName: 'Ava', lastName: 'Lee', dateOfBirth: new Date(Date.UTC(2014, 4, 2)), schoolDojang: null, weightLbs: 60 };
    const { entries, summary } = await planTournamentImport(fakeDb({ competitors: [ava] }), {
      tournament: TOURNAMENT, rows: prepared.rows, skipped: [], matchScope: {},
    });
    expect(summary).toMatchObject({
      newCompetitors: 2, matchedCompetitors: 1, registrationsToCreate: 3, waitlisted: 0,
      registrationsUpdated: 0, events: { patterns: 2, sparring: 2 }, skippedCount: 0, planLimit: null,
    });
    expect(entries[0]).toMatchObject({ kind: 'register', competitorId: 'ava', weightLbs: 72 });
    expect(entries[1]).toMatchObject({ kind: 'register', competitorId: null });
  });

  it('adds missing events to an existing registration and skips ones with nothing new', async () => {
    const people = ['Ava', 'Ben'].map((first) => ({
      id: first, firstName: first, lastName: 'Lee', dateOfBirth: new Date(Date.UTC(2014, 4, 2)), schoolDojang: null, weightLbs: 70,
    }));
    const { entries, summary } = await planTournamentImport(fakeDb({
      competitors: people,
      registrations: [
        { id: 'r-ava', competitorId: 'Ava', patterns: true, sparring: false, waitlistStatus: 'active' },
        { id: 'r-ben', competitorId: 'Ben', patterns: true, sparring: false, waitlistStatus: 'active' },
      ],
    }), { tournament: TOURNAMENT, rows: prepared.rows, skipped: [], matchScope: {} });
    expect(summary).toMatchObject({ registrationsToCreate: 1, registrationsUpdated: 1, events: { patterns: 0, sparring: 2 } });
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'add-events', registrationId: 'r-ben', patterns: false, sparring: true }));
    expect(summary.skipped).toEqual([{ row: 2, name: 'Ava Lee', reason: 'Already registered for these events' }]);
  });

  it('never re-adds a withdrawn registration', async () => {
    const ava = { id: 'ava', firstName: 'Ava', lastName: 'Lee', dateOfBirth: new Date(Date.UTC(2014, 4, 2)), schoolDojang: null, weightLbs: 70 };
    const { summary } = await planTournamentImport(fakeDb({
      competitors: [ava],
      registrations: [{ id: 'r', competitorId: 'ava', patterns: false, sparring: false, waitlistStatus: 'withdrawn' }],
    }), { tournament: TOURNAMENT, rows: prepared.rows.slice(0, 1), skipped: [], matchScope: {} });
    expect(summary.registrationsToCreate).toBe(0);
    expect(summary.skipped[0].reason).toMatch(/^Withdrawn/);
  });

  it('fills free spots, then the waiting list', async () => {
    const { entries, summary } = await planTournamentImport(fakeDb({
      registrations: [
        { id: 'x', competitorId: 'x', patterns: true, sparring: false, waitlistStatus: 'active' },
        { id: 'w', competitorId: 'w', patterns: true, sparring: false, waitlistStatus: 'waitlisted', waitlistPosition: 4 },
      ],
    }), { tournament: { ...TOURNAMENT, maxCapacity: 2, waitlistEnabled: true }, rows: prepared.rows, skipped: [], matchScope: {} });
    expect(summary).toMatchObject({ registrationsToCreate: 3, waitlisted: 2 });
    expect(entries.map((e) => (e.kind === 'register' ? [e.waitlistStatus, e.waitlistPosition] : null))).toEqual([
      ['active', null],
      ['waitlisted', 5],
      ['waitlisted', 6],
    ]);
  });

  it('skips rows once a tournament without a waiting list is full', async () => {
    const { summary } = await planTournamentImport(fakeDb({}), {
      tournament: { ...TOURNAMENT, maxCapacity: 1 }, rows: prepared.rows, skipped: [], matchScope: {},
    });
    expect(summary.registrationsToCreate).toBe(1);
    expect(summary.newCompetitors).toBe(1);
    expect(summary.skipped.map((s) => s.reason)).toEqual([
      'The tournament is full and has no waiting list',
      'The tournament is full and has no waiting list',
    ]);
  });

  it('reports the plan limit like bulk registration', async () => {
    const existing = Array.from({ length: 29 }, (_, i) => ({
      id: `r${i}`, competitorId: `c${i}`, patterns: true, sparring: false, waitlistStatus: 'active',
    }));
    const { summary } = await planTournamentImport(fakeDb({ registrations: existing }), {
      tournament: { ...TOURNAMENT, plan: 'free' }, rows: prepared.rows, skipped: [], matchScope: {},
    });
    expect(summary.planLimit).toEqual({ limit: 30, current: 29, requested: 3 });
  });
});

/**
 * Import a spreadsheet straight into one tournament (roadmap #11).
 *
 * Each row is one competitor. A Y / Yes / X / 1 in an event column (the
 * tournament's first or second event slot) registers them for that event.
 *
 * Invariants:
 * - Existing competitor rows are never modified. A row that matches an
 *   existing competitor (same tenant, same name + date of birth) reuses
 *   it; otherwise a new competitor is created for the tournament's tenant.
 * - Existing registrations only gain events, never lose them.
 * - Capacity: new registrations take the free spots, then go on the
 *   waiting list when it is on; with no waiting list a full tournament
 *   skips the rest. Plan limits are checked like bulk registration.
 * - Preview and commit run the same planning code; the commit re-plans
 *   inside one transaction that holds the tournament row lock.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { calculateAge } from '../../shared/constants/age-groups.js';
import type { EventSlot } from '../../shared/constants/sport-profiles.js';
import {
  prepareImportRows,
  type ColumnMapping,
  type ExcelCellValue,
  type ExcelRow,
  type PreparedImportRow,
} from './excel-import.js';
import { canAddBulkRegistrations, getPlanEntitlements } from './entitlements.js';
import { CAPACITY_HOLDING_STATUSES, decideRegistrationSlot, lockTournamentForCapacity } from './waitlist.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Most skipped rows listed back to the client (the count is always exact). */
export const MAX_SKIPPED_ROWS_LISTED = 500;
const MATCH_QUERY_CHUNK = 100;
const IMPORT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

const MARKED_VALUES = new Set(['y', 'yes', 'x', '1', 'true', '✓', '✔']);

/** True when an event cell says "entered": Y, Yes, X or 1 (any case). */
export function isEventMarked(value: ExcelCellValue): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;
  return MARKED_VALUES.has(value.trim().toLowerCase());
}

/**
 * Columns the import cannot work without, in plain words. Weight is
 * optional here (forms-only spreadsheets often leave it out).
 */
export function missingImportColumns(mapping: Partial<ColumnMapping>): string[] {
  const missing: string[] = [];
  if (!((mapping.firstName && mapping.lastName) || mapping.name)) missing.push('First and last name (or one name column)');
  if (!mapping.gender) missing.push('Gender');
  if (!mapping.dateOfBirth && !mapping.age) missing.push('Date of birth (or age)');
  if (!mapping.belt) missing.push('Belt');
  if (!mapping.patterns && !mapping.sparring) missing.push('At least one event column');
  return missing;
}

export interface TournamentImportRow extends PreparedImportRow {
  patterns: boolean;
  sparring: boolean;
}

export interface SkippedImportRow {
  row: number;
  name: string | null;
  reason: string;
}

const personKey = (r: { firstName: string; lastName: string; dateOfBirth: Date }) =>
  `${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}|${r.dateOfBirth.toISOString().slice(0, 10)}`;

/**
 * Validate rows and read their event marks (no database access). Rows
 * with no event marked, and repeats of a person already listed, are
 * skipped with a reason.
 */
export function prepareTournamentImportRows(
  rows: ExcelRow[],
  mapping: Partial<ColumnMapping>,
): { rows: TournamentImportRow[]; skipped: SkippedImportRow[] } {
  const { prepared, errors } = prepareImportRows(rows, mapping);
  const skipped: SkippedImportRow[] = errors.map((e) => ({ row: e.row, name: null, reason: e.message }));
  const out: TournamentImportRow[] = [];
  const seen = new Map<string, number>();
  for (const row of prepared) {
    const source = rows[row.sourceIndex];
    const patterns = mapping.patterns ? isEventMarked(source[mapping.patterns]) : false;
    const sparring = mapping.sparring ? isEventMarked(source[mapping.sparring]) : false;
    const name = `${row.firstName} ${row.lastName}`;
    if (!patterns && !sparring) {
      skipped.push({ row: row.rowNum, name, reason: 'No event marked' });
      continue;
    }
    const key = personKey(row);
    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      skipped.push({ row: row.rowNum, name, reason: `Same person as row ${firstRow}` });
      continue;
    }
    seen.set(key, row.rowNum);
    out.push({ ...row, patterns, sparring });
  }
  skipped.sort((a, b) => a.row - b.row);
  return { rows: out, skipped };
}

/**
 * Existing competitors an import into a tournament may reuse: those of the
 * tournament's tenant only. For an organization tournament, competitors
 * owned by or registered with that organization and registered nowhere
 * else; for an org-less tournament, org-less competitors registered only
 * in org-less tournaments.
 */
export function tournamentCompetitorScope(organizationId: string | null): Prisma.CompetitorWhereInput {
  if (organizationId) {
    return {
      registrations: { every: { tournament: { organizationId } } },
      OR: [
        { organizationId },
        { registrations: { some: { tournament: { organizationId } } } },
      ],
    };
  }
  return {
    organizationId: null,
    registrations: { every: { tournament: { organizationId: null } } },
  };
}

export interface MatchCandidate {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  schoolDojang: string | null;
  weightLbs: number | null;
}

/**
 * Same person? Name (any case) plus exact date of birth. An age-only row
 * has a made-up 1 January birthday, so it matches on name + school + a
 * birth year either side of the one implied by the age instead (the same
 * rule as the registry import).
 */
export function competitorMatchesRow(candidate: MatchCandidate, row: PreparedImportRow): boolean {
  if (candidate.firstName.toLowerCase() !== row.firstName.toLowerCase()) return false;
  if (candidate.lastName.toLowerCase() !== row.lastName.toLowerCase()) return false;
  if (row.syntheticBirthYear === null) return candidate.dateOfBirth.getTime() === row.dateOfBirth.getTime();
  const year = candidate.dateOfBirth.getUTCFullYear();
  if (year < row.syntheticBirthYear - 1 || year > row.syntheticBirthYear) return false;
  const a = candidate.schoolDojang?.toLowerCase() ?? null;
  const b = row.schoolDojang?.toLowerCase() ?? null;
  return a === b;
}

function rowMatchWhere(row: PreparedImportRow): Prisma.CompetitorWhereInput {
  const name: Prisma.CompetitorWhereInput = {
    firstName: { equals: row.firstName, mode: 'insensitive' },
    lastName: { equals: row.lastName, mode: 'insensitive' },
  };
  if (row.syntheticBirthYear === null) return { ...name, dateOfBirth: row.dateOfBirth };
  return {
    ...name,
    dateOfBirth: {
      gte: new Date(Date.UTC(row.syntheticBirthYear - 1, 0, 1)),
      lt: new Date(Date.UTC(row.syntheticBirthYear + 1, 0, 1)),
    },
  };
}

export interface ImportTournament {
  id: string;
  date: Date;
  organizationId: string | null;
  maxCapacity: number | null;
  waitlistEnabled: boolean;
  plan: string;
}

export interface TournamentImportSummary {
  /** Rows with a competitor and at least one event (before matching). */
  rowsReady: number;
  newCompetitors: number;
  matchedCompetitors: number;
  /** New registrations, including those placed on the waiting list. */
  registrationsToCreate: number;
  waitlisted: number;
  /** Existing registrations that gain an event. */
  registrationsUpdated: number;
  /** Event entries added, per slot. */
  events: Record<EventSlot, number>;
  skippedCount: number;
  /** Skipped rows with reasons (first {@link MAX_SKIPPED_ROWS_LISTED}). */
  skipped: SkippedImportRow[];
  /** Set when the plan's competitor limit would be exceeded. */
  planLimit: { limit: number; current: number; requested: number } | null;
}

type PlanEntry =
  | {
      kind: 'register';
      row: TournamentImportRow;
      competitorId: string | null; // null = create a new competitor
      dateOfBirth: Date;
      weightLbs: number | null;
      waitlistStatus: 'active' | 'waitlisted';
      waitlistPosition: number | null;
    }
  | { kind: 'add-events'; row: TournamentImportRow; registrationId: string; patterns: boolean; sparring: boolean };

/**
 * Decide what each row does: which competitor it uses, whether it creates
 * a registration (active or waitlisted) or adds events to an existing one,
 * or why it is skipped. Reads only.
 */
export async function planTournamentImport(
  db: Db,
  input: {
    tournament: ImportTournament;
    rows: TournamentImportRow[];
    skipped: SkippedImportRow[];
    matchScope: Prisma.CompetitorWhereInput;
  },
): Promise<{ entries: PlanEntry[]; summary: TournamentImportSummary }> {
  const { tournament, rows, matchScope } = input;
  const skipped = [...input.skipped];
  const skip = (row: TournamentImportRow, reason: string) =>
    skipped.push({ row: row.rowNum, name: `${row.firstName} ${row.lastName}`, reason });

  // 1. Match existing competitors (oldest record wins, like other imports).
  const matches = new Map<TournamentImportRow, MatchCandidate>();
  for (let start = 0; start < rows.length; start += MATCH_QUERY_CHUNK) {
    const chunk = rows.slice(start, start + MATCH_QUERY_CHUNK);
    const candidates = await db.competitor.findMany({
      where: { deletedAt: null, AND: [matchScope, { OR: chunk.map(rowMatchWhere) }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, schoolDojang: true, weightLbs: true },
    });
    for (const row of chunk) {
      const found = candidates.find((c) => competitorMatchesRow(c, row));
      if (found) matches.set(row, found);
    }
  }

  // 2. Registrations those competitors already have here.
  const matchedIds = [...new Set([...matches.values()].map((c) => c.id))];
  const existing = matchedIds.length
    ? await db.registration.findMany({
        where: { tournamentId: tournament.id, competitorId: { in: matchedIds } },
        select: { id: true, competitorId: true, patterns: true, sparring: true, waitlistStatus: true },
      })
    : [];
  const existingByCompetitor = new Map(existing.map((r) => [r.competitorId, r]));

  // 3. Capacity as it stands now.
  let activeCount = tournament.maxCapacity
    ? await db.registration.count({
        where: { tournamentId: tournament.id, waitlistStatus: { in: [...CAPACITY_HOLDING_STATUSES] } },
      })
    : 0;
  let lastWaitlistPosition: number | null = null;
  if (tournament.maxCapacity && tournament.waitlistEnabled) {
    const last = await db.registration.findFirst({
      where: { tournamentId: tournament.id, waitlistStatus: 'waitlisted' },
      orderBy: { waitlistPosition: 'desc' },
      select: { waitlistPosition: true },
    });
    lastWaitlistPosition = last?.waitlistPosition ?? null;
  }

  const entries: PlanEntry[] = [];
  const usedCompetitors = new Map<string, number>();
  const events: Record<EventSlot, number> = { patterns: 0, sparring: 0 };
  let newCompetitors = 0;
  let matchedCompetitors = 0;
  let waitlisted = 0;

  for (const row of rows) {
    const match = matches.get(row) ?? null;
    if (match) {
      const earlier = usedCompetitors.get(match.id);
      if (earlier !== undefined) {
        skip(row, `Same person as row ${earlier}`);
        continue;
      }
      usedCompetitors.set(match.id, row.rowNum);
      const registration = existingByCompetitor.get(match.id);
      if (registration) {
        if (registration.waitlistStatus === 'withdrawn') {
          skip(row, 'Withdrawn from this tournament. Add them back on the tournament page if needed');
          continue;
        }
        const patterns = row.patterns && !registration.patterns;
        const sparring = row.sparring && !registration.sparring;
        if (!patterns && !sparring) {
          skip(row, 'Already registered for these events');
          continue;
        }
        entries.push({ kind: 'add-events', row, registrationId: registration.id, patterns, sparring });
        matchedCompetitors++;
        if (patterns) events.patterns++;
        if (sparring) events.sparring++;
        continue;
      }
    }

    const decision = decideRegistrationSlot({
      maxCapacity: tournament.maxCapacity,
      waitlistEnabled: tournament.waitlistEnabled,
      activeCount,
      maxWaitlistPosition: lastWaitlistPosition,
    });
    if (decision.kind === 'full') {
      skip(row, 'The tournament is full and has no waiting list');
      continue;
    }
    if (decision.kind === 'waitlisted') {
      lastWaitlistPosition = decision.position;
      waitlisted++;
    } else {
      activeCount++;
    }
    entries.push({
      kind: 'register',
      row,
      competitorId: match?.id ?? null,
      dateOfBirth: match?.dateOfBirth ?? row.dateOfBirth,
      // The registration keeps the weight from the sheet; the competitor
      // record itself is never changed.
      weightLbs: row.weightLbs ?? match?.weightLbs ?? null,
      waitlistStatus: decision.kind === 'waitlisted' ? 'waitlisted' : 'active',
      waitlistPosition: decision.kind === 'waitlisted' ? decision.position : null,
    });
    if (match) matchedCompetitors++;
    else newCompetitors++;
    if (row.patterns) events.patterns++;
    if (row.sparring) events.sparring++;
  }

  const registrationsToCreate = entries.filter((e) => e.kind === 'register').length;
  let planLimit: TournamentImportSummary['planLimit'] = null;
  if (registrationsToCreate > 0) {
    // Same count and rule as bulk registration.
    const current = await db.registration.count({ where: { tournamentId: tournament.id } });
    if (!canAddBulkRegistrations(tournament.plan, current, registrationsToCreate)) {
      planLimit = {
        limit: getPlanEntitlements(tournament.plan).maxCompetitorsPerTournament,
        current,
        requested: registrationsToCreate,
      };
    }
  }

  skipped.sort((a, b) => a.row - b.row);
  return {
    entries,
    summary: {
      rowsReady: rows.length,
      newCompetitors,
      matchedCompetitors,
      registrationsToCreate,
      waitlisted,
      registrationsUpdated: entries.length - registrationsToCreate,
      events,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, MAX_SKIPPED_ROWS_LISTED),
      planLimit,
    },
  };
}

export class TournamentImportLimitError extends Error {
  readonly status = 402;
  constructor(readonly planLimit: NonNullable<TournamentImportSummary['planLimit']>) {
    super(`registration limit of ${planLimit.limit} reached`);
    this.name = 'TournamentImportLimitError';
  }
}

export class TournamentImportNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super('Tournament not found');
    this.name = 'TournamentImportNotFoundError';
  }
}

/**
 * Plan and write the import in one transaction under the tournament row
 * lock, so capacity and the plan limit cannot change between the check
 * and the insert. Returns what was done.
 */
export async function applyTournamentImport(
  prisma: PrismaClient,
  input: {
    tournament: ImportTournament;
    rows: TournamentImportRow[];
    skipped: SkippedImportRow[];
    matchScope: Prisma.CompetitorWhereInput;
  },
): Promise<TournamentImportSummary> {
  return prisma.$transaction(async (tx) => {
    const locked = await lockTournamentForCapacity(tx, input.tournament.id);
    if (!locked) throw new TournamentImportNotFoundError();
    const tournament = { ...input.tournament, maxCapacity: locked.maxCapacity, waitlistEnabled: locked.waitlistEnabled };
    const { entries, summary } = await planTournamentImport(tx, { ...input, tournament });
    if (summary.planLimit) throw new TournamentImportLimitError(summary.planLimit);

    const newCompetitors: Prisma.CompetitorCreateManyInput[] = [];
    const registrations: Prisma.RegistrationCreateManyInput[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'register') continue;
      let competitorId = entry.competitorId;
      if (!competitorId) {
        competitorId = randomUUID();
        const r = entry.row;
        newCompetitors.push({
          id: competitorId,
          firstName: r.firstName,
          lastName: r.lastName,
          gender: r.gender,
          dateOfBirth: r.dateOfBirth,
          belt: r.belt,
          danRank: r.danRank,
          heightInches: r.heightInches,
          weightLbs: r.weightLbs,
          schoolDojang: r.schoolDojang,
          specialNeeds: r.specialNeeds,
          organizationId: tournament.organizationId,
        });
      }
      registrations.push({
        tournamentId: tournament.id,
        competitorId,
        patterns: entry.row.patterns,
        sparring: entry.row.sparring,
        weightAtRegistration: entry.weightLbs,
        ageAtTournament: calculateAge(entry.dateOfBirth, tournament.date),
        waitlistStatus: entry.waitlistStatus,
        waitlistPosition: entry.waitlistPosition,
      });
    }
    if (newCompetitors.length) await tx.competitor.createMany({ data: newCompetitors });
    if (registrations.length) await tx.registration.createMany({ data: registrations });
    for (const entry of entries) {
      if (entry.kind !== 'add-events') continue;
      // Only ever switch events on.
      await tx.registration.update({
        where: { id: entry.registrationId },
        data: { ...(entry.patterns ? { patterns: true } : {}), ...(entry.sparring ? { sparring: true } : {}) },
      });
    }
    return summary;
  }, IMPORT_TRANSACTION_OPTIONS);
}

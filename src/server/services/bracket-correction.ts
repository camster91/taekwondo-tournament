import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { generateBracket, generateSingleElimination, type BracketStructure, type SeedingStrategy } from './bracket-generator.js';
import { generatePoolPlay, generateRoundRobin } from './bracket-formats.js';
import { handleByeMatches } from './match-advancement.js';

export interface BracketCorrectionAssignment {
  registrationId: string;
  seedPosition: number | null;
  firstName: string;
  lastName: string;
  school: string;
}

export interface BracketCorrectionMatch {
  id?: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  winnerId?: string | null;
  // SH-4: legacy `score1`/`score2`/`notes`/`ringNumber` fields were
  // replaced by the schema-aligned columns. `scores` is the JSON
  // payload (string form on the wire, parsed at the renderer).
  // `scheduledTime` was renamed to `scheduledAt`; `ringNumber` is now
  // a free-form ring label stored as `ring` on the schema. The local
  // snapshot mirrors the schema so the version hash and restore path
  // stay consistent with what the DB actually stores.
  scores?: string | null;
  ring?: string | null;
  scheduledAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BracketCorrectionSnapshot {
  tournamentId: string;
  divisionId: string;
  divisionName: string;
  assignments: BracketCorrectionAssignment[];
  bracket: null | {
    id: string;
    format: string;
    structure: string;
    createdAt?: string;
    updatedAt: string;
    matches: BracketCorrectionMatch[];
  };
  matchAuditCount: number;
  matchupHistoryCount: number;
  matchAuditRows: Array<Record<string, unknown>>;
  matchupHistoryRows: Array<Record<string, unknown>>;
}

export interface ProposedBracketCorrection {
  format: string;
  seedingStrategy: string;
  structure?: BracketStructure;
  matches: BracketCorrectionMatch[];
}

export interface BracketCorrectionConfig {
  format: 'double_elim' | 'single_elim' | 'round_robin' | 'pool_play';
  seedingStrategy: SeedingStrategy;
  poolCount?: number;
  advancePerPool?: number;
}

export function assertDeterministicCorrectionConfig(config: BracketCorrectionConfig): void {
  if (config.seedingStrategy === 'random' || config.seedingStrategy === 'fairness_optimized') {
    throw new Error('Bracket corrections require a deterministic seeding strategy');
  }
}

export interface BracketCorrectionImpact {
  divisionId: string;
  divisionLabel: string;
  competitorCount: number;
  oldFormat: string | null;
  newFormat: string;
  oldMatchCount: number;
  newMatchCount: number;
  completedMatchesRemoved: number;
  inProgressMatchesBlocked: number;
  scoredMatchesRemoved: number;
  // SH-4: `notesRemoved` is gone. The legacy `notes` column was
  // dropped from the schema; the new `scores` JSON may contain
  // structured override metadata (manualOverride + overrideReason)
  // but those are surfaced via scoredMatchesRemoved.
  matchAuditRowsRemoved: number;
  matchupHistoryRowsRemoved: number;
  oldByeCount: number;
  newByeCount: number;
  changedFirstRoundPairings: Array<{ matchNumber: number; before: string[]; after: string[] }>;
  reversible: boolean;
}

function stableSnapshot(snapshot: BracketCorrectionSnapshot) {
  return {
    ...snapshot,
    assignments: [...snapshot.assignments].sort((a, b) => a.registrationId.localeCompare(b.registrationId)),
    bracket: snapshot.bracket ? {
      ...snapshot.bracket,
      matches: [...snapshot.bracket.matches].sort((a, b) => a.matchNumber - b.matchNumber || a.bracketType.localeCompare(b.bracketType)),
    } : null,
  };
}

export function bracketCorrectionVersion(snapshot: BracketCorrectionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(stableSnapshot(snapshot))).digest('hex');
}

export function buildProposedBracketCorrection(
  snapshot: BracketCorrectionSnapshot,
  config: BracketCorrectionConfig,
): ProposedBracketCorrection {
  assertDeterministicCorrectionConfig(config);
  const competitors = snapshot.assignments.map((assignment) => ({
    registrationId: assignment.registrationId,
    name: `${assignment.firstName} ${assignment.lastName}`.trim(),
    school: assignment.school,
    seedPosition: assignment.seedPosition,
  }));
  let structure: BracketStructure;
  if (config.format === 'single_elim') structure = generateSingleElimination(competitors, config.seedingStrategy);
  else if (config.format === 'round_robin') structure = generateRoundRobin(competitors, { seedingStrategy: config.seedingStrategy });
  else if (config.format === 'pool_play') structure = generatePoolPlay(competitors, {
    seedingStrategy: config.seedingStrategy,
    poolCount: config.poolCount,
    advancePerPool: config.advancePerPool,
  });
  else structure = generateBracket(competitors, config.seedingStrategy);
  const matches = [
    ...structure.winners.map((match) => ({ ...match, bracketType: 'winners' })),
    ...structure.losers.map((match) => ({ ...match, bracketType: 'losers' })),
    ...structure.finals.map((match) => ({ ...match, bracketType: 'finals' })),
  ].map((match) => ({
    matchNumber: match.matchNumber,
    roundNumber: match.round,
    bracketType: match.bracketType,
    competitor1Id: match.competitor1Id,
    competitor2Id: match.competitor2Id,
    status: match.competitor1Id && match.competitor2Id ? 'ready' : 'pending',
  }));
  return { format: config.format, seedingStrategy: config.seedingStrategy, structure, matches };
}

export function proposedBracketVersion(proposed: ProposedBracketCorrection): string {
  return createHash('sha256').update(JSON.stringify(proposed)).digest('hex');
}

export function assertInitialBracketGeneration(existingBracket: { id: string } | null): void {
  if (existingBracket) throw new Error('Existing brackets must use the correction preview');
}

function isBye(match: BracketCorrectionMatch): boolean {
  return match.status === 'bye'
    || (match.roundNumber === 1 && Boolean(match.competitor1Id) !== Boolean(match.competitor2Id));
}

export function buildBracketCorrectionImpact(
  snapshot: BracketCorrectionSnapshot,
  proposed: ProposedBracketCorrection,
): BracketCorrectionImpact {
  const oldMatches = snapshot.bracket?.matches ?? [];
  const names = new Map(snapshot.assignments.map((assignment) => [
    assignment.registrationId,
    `${assignment.firstName} ${assignment.lastName}`.trim(),
  ]));
  const pairing = (match: BracketCorrectionMatch | undefined) => match
    ? [match.competitor1Id, match.competitor2Id].filter((id): id is string => Boolean(id)).map((id) => names.get(id) ?? id)
    : [];
  const oldFirstRound = new Map(oldMatches
    .filter((match) => match.roundNumber === 1)
    .map((match) => [`${match.bracketType}:${match.matchNumber}`, match]));
  const changedFirstRoundPairings = proposed.matches
    .filter((match) => match.roundNumber === 1)
    .flatMap((match) => {
      const before = pairing(oldFirstRound.get(`${match.bracketType}:${match.matchNumber}`));
      const after = pairing(match);
      return JSON.stringify(before) === JSON.stringify(after)
        ? []
        : [{ matchNumber: match.matchNumber, before, after }];
    });

  return {
    divisionId: snapshot.divisionId,
    divisionLabel: snapshot.divisionName,
    competitorCount: snapshot.assignments.length,
    oldFormat: snapshot.bracket?.format ?? null,
    newFormat: proposed.format,
    oldMatchCount: oldMatches.length,
    newMatchCount: proposed.matches.length,
    completedMatchesRemoved: oldMatches.filter((match) => match.status === 'completed').length,
    inProgressMatchesBlocked: oldMatches.filter((match) => match.status === 'in_progress').length,
    // SH-4: `scores` is now a JSON string. Treat any non-empty value
    // (even invalid JSON) as a recorded score — the bracket was in
    // use and downstream matches may have already inherited the
    // winner, so a non-null payload means the snapshot has scoring
    // data we are about to drop.
    scoredMatchesRemoved: oldMatches.filter((match) => match.scores !== null && match.scores !== undefined && match.scores !== '').length,
    matchAuditRowsRemoved: snapshot.matchAuditCount,
    matchupHistoryRowsRemoved: snapshot.matchupHistoryCount,
    oldByeCount: oldMatches.filter(isBye).length,
    newByeCount: proposed.matches.filter(isBye).length,
    changedFirstRoundPairings,
    reversible: true,
  };
}

interface ApplyBracketCorrectionInput {
  tournamentId: string;
  divisionId: string;
  config: BracketCorrectionConfig;
  expectedInputVersion: string;
  expectedResultVersion: string;
  operationKey: string;
  approvedBy: string;
}

type BracketCorrectionDb = PrismaClient | Prisma.TransactionClient;

interface BracketCorrectionDependencies {
  loadSnapshot: (tx: BracketCorrectionDb, divisionId: string) => Promise<BracketCorrectionSnapshot>;
  initializeByes: (tx: BracketCorrectionDb, bracketId: string) => Promise<number>;
}

export async function previewBracketCorrection(
  prisma: PrismaClient,
  divisionId: string,
  config: BracketCorrectionConfig,
  operationKey: string,
  dependencies: Pick<Partial<BracketCorrectionDependencies>, 'loadSnapshot'> = {},
) {
  const loadSnapshot = dependencies.loadSnapshot ?? loadBracketCorrectionSnapshot;
  return prisma.$transaction(async (tx) => {
    const snapshot = await loadSnapshot(tx, divisionId);
    const proposed = buildProposedBracketCorrection(snapshot, config);
    return {
      tournamentId: snapshot.tournamentId,
      divisionId,
      divisionLabel: snapshot.divisionName,
      proposedConfig: config,
      proposed,
      impact: buildBracketCorrectionImpact(snapshot, proposed),
      expectedInputVersion: bracketCorrectionVersion(snapshot),
      expectedResultVersion: proposedBracketVersion(proposed),
      operationKey,
    };
  }, { isolationLevel: 'Serializable' });
}

export async function loadBracketCorrectionSnapshot(tx: BracketCorrectionDb, divisionId: string): Promise<BracketCorrectionSnapshot> {
  const division = await tx.division.findUnique({
    where: { id: divisionId },
    include: {
      assignments: {
        orderBy: { seedPosition: 'asc' },
        include: { registration: { include: { competitor: true } } },
      },
      bracket: { include: { matches: { orderBy: [{ bracketType: 'asc' }, { roundNumber: 'asc' }, { matchNumber: 'asc' }] } } },
    },
  });
  if (!division) throw new Error('Division not found');
  const matchIds = division.bracket?.matches.map((match: { id: string }) => match.id) ?? [];
  const [matchAuditRows, matchupHistoryRows] = matchIds.length > 0
    ? await Promise.all([
      tx.matchAuditLog.findMany({ where: { matchId: { in: matchIds } }, orderBy: { createdAt: 'asc' } }),
      tx.matchupHistory.findMany({ where: { matchId: { in: matchIds } }, orderBy: { createdAt: 'asc' } }),
    ])
    : [[], []];
  const serializeRow = (row: Record<string, unknown>) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  return {
    tournamentId: division.tournamentId,
    divisionId: division.id,
    divisionName: division.name,
    assignments: division.assignments.map((assignment) => ({
      registrationId: assignment.registrationId,
      seedPosition: assignment.seedPosition,
      firstName: assignment.registration.competitor.firstName,
      lastName: assignment.registration.competitor.lastName,
      school: assignment.registration.competitor.schoolDojang ?? '',
    })),
    bracket: division.bracket ? {
      id: division.bracket.id,
      format: division.bracket.format,
      structure: division.bracket.structure,
      createdAt: division.bracket.createdAt.toISOString(),
      updatedAt: division.bracket.updatedAt.toISOString(),
      matches: division.bracket.matches.map((match) => serializeRow(match as unknown as Record<string, unknown>) as unknown as BracketCorrectionMatch),
    } : null,
    matchAuditCount: matchAuditRows.length,
    matchupHistoryCount: matchupHistoryRows.length,
    matchAuditRows: matchAuditRows.map((row) => serializeRow(row as unknown as Record<string, unknown>)),
    matchupHistoryRows: matchupHistoryRows.map((row) => serializeRow(row as unknown as Record<string, unknown>)),
  };
}

function restoreDateFields(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const restored = { ...row };
  for (const field of fields) {
    if (typeof restored[field] === 'string') restored[field] = new Date(restored[field] as string);
  }
  return restored;
}

export async function undoBracketCorrection(
  prisma: PrismaClient,
  tournamentId: string,
  divisionId: string,
  auditId: string,
  undoneBy: string,
  now = new Date(),
  dependencies: Pick<Partial<BracketCorrectionDependencies>, 'loadSnapshot'> = {},
): Promise<void> {
  const loadSnapshot = dependencies.loadSnapshot ?? loadBracketCorrectionSnapshot;
  try {
    await prisma.$transaction(async (tx) => {
      const audit = await tx.tournamentOperationAudit.findUnique({ where: { id: auditId } });
      if (!audit || audit.tournamentId !== tournamentId || audit.operationType !== 'bracket_reseed' || !audit.reversible) {
        throw new Error('Bracket correction cannot be undone');
      }
      if (audit.undoneAt) return;
      const before = JSON.parse(audit.beforeState ?? 'null') as BracketCorrectionSnapshot | null;
      const after = JSON.parse(audit.afterState) as BracketCorrectionSnapshot;
      if (!before || before.divisionId !== divisionId || after.divisionId !== divisionId) throw new Error('Bracket correction cannot be undone');
      const current = await loadSnapshot(tx, divisionId);
      if (bracketCorrectionVersion(current) !== bracketCorrectionVersion(after)) {
        throw new Error('Bracket changed after this correction; undo is unsafe');
      }
      const currentMatchIds = current.bracket?.matches.map((match) => match.id).filter((id): id is string => Boolean(id)) ?? [];
      if (currentMatchIds.length > 0) {
        await tx.matchAuditLog.deleteMany({ where: { matchId: { in: currentMatchIds } } });
        await tx.matchupHistory.deleteMany({ where: { matchId: { in: currentMatchIds } } });
      }
      await tx.bracket.deleteMany({ where: { divisionId } });
      if (before.bracket) {
        await tx.bracket.create({ data: {
          id: before.bracket.id,
          divisionId,
          structure: before.bracket.structure,
          format: before.bracket.format,
          ...(before.bracket.createdAt ? { createdAt: new Date(before.bracket.createdAt) } : {}),
          updatedAt: new Date(before.bracket.updatedAt),
        } });
        if (before.bracket.matches.length > 0) {
          // SH-4: `scheduledTime` was renamed to `scheduledAt` in the
          // schema; restore path uses the schema name.
          await tx.match.createMany({ data: before.bracket.matches.map((match) => restoreDateFields(match as unknown as Record<string, unknown>, ['scheduledAt', 'createdAt', 'updatedAt'])) as unknown as Prisma.MatchCreateManyInput[] });
        }
      }
      if (before.matchAuditRows.length > 0) {
        await tx.matchAuditLog.createMany({ data: before.matchAuditRows.map((row) => restoreDateFields(row, ['createdAt'])) as unknown as Prisma.MatchAuditLogCreateManyInput[] });
      }
      if (before.matchupHistoryRows.length > 0) {
        await tx.matchupHistory.createMany({ data: before.matchupHistoryRows.map((row) => restoreDateFields(row, ['createdAt'])) as unknown as Prisma.MatchupHistoryCreateManyInput[] });
      }
      const marked = await tx.tournamentOperationAudit.updateMany({
        where: { id: auditId, undoneAt: null }, data: { undoneAt: now, undoneBy },
      });
      if (marked.count !== 1) throw new Error('Bracket correction cannot be undone');
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    const current = await prisma.tournamentOperationAudit.findUnique({ where: { id: auditId } });
    if (current?.undoneAt && current.tournamentId === tournamentId) return;
    throw error;
  }
}

export async function getBracketCorrectionStatus(
  prisma: PrismaClient,
  tournamentId: string,
  divisionId: string,
  operationKey: string,
) {
  const audit = await prisma.tournamentOperationAudit.findUnique({ where: { operationKey } });
  if (!audit || audit.tournamentId !== tournamentId || audit.operationType !== 'bracket_reseed') return null;
  try {
    const before = JSON.parse(audit.beforeState ?? 'null') as BracketCorrectionSnapshot | null;
    if (!before || before.divisionId !== divisionId) return null;
  } catch {
    return null;
  }
  return { auditId: audit.id, applied: true, undone: Boolean(audit.undoneAt), createdAt: audit.createdAt.toISOString() };
}

export async function applyBracketCorrection(
  prisma: PrismaClient,
  input: ApplyBracketCorrectionInput,
  dependencies: Partial<BracketCorrectionDependencies> = {},
): Promise<{ auditId: string; alreadyApplied: boolean; impact: BracketCorrectionImpact }> {
  const loadSnapshot = dependencies.loadSnapshot ?? loadBracketCorrectionSnapshot;
  const initializeByes = dependencies.initializeByes ?? ((tx, bracketId) => handleByeMatches(tx as PrismaClient, bracketId));
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tournamentOperationAudit.findUnique({ where: { operationKey: input.operationKey } });
    const evidence = {
      divisionId: input.divisionId,
      config: input.config,
      expectedInputVersion: input.expectedInputVersion,
      expectedResultVersion: input.expectedResultVersion,
    };
    if (existing) {
      if (existing.tournamentId !== input.tournamentId || existing.operationType !== 'bracket_reseed' || existing.undoneAt) {
        throw new Error('Bracket operation key is already in use');
      }
      const stored = JSON.parse(existing.impactSummary) as BracketCorrectionImpact & { _operation?: unknown };
      if (JSON.stringify(stored._operation) !== JSON.stringify(evidence)) throw new Error('Bracket operation key is already in use');
      const { _operation: _ignored, ...impact } = stored;
      return { auditId: existing.id, alreadyApplied: true, impact } as { auditId: string; alreadyApplied: boolean; impact: BracketCorrectionImpact };
    }
    const snapshot = await loadSnapshot(tx, input.divisionId);
    if (snapshot.tournamentId !== input.tournamentId || snapshot.divisionId !== input.divisionId || bracketCorrectionVersion(snapshot) !== input.expectedInputVersion) {
      throw new Error('Bracket preview is stale');
    }
    const proposed = buildProposedBracketCorrection(snapshot, input.config);
    const impact = buildBracketCorrectionImpact(snapshot, proposed);
    if (impact.inProgressMatchesBlocked > 0) throw new Error('Bracket cannot be reseeded while a match is in progress');
    if (proposedBracketVersion(proposed) !== input.expectedResultVersion) {
      throw new Error('Bracket preview is stale');
    }
    const oldMatchIds = snapshot.bracket?.matches.map((match) => match.id).filter((id): id is string => Boolean(id)) ?? [];
    if (oldMatchIds.length > 0) {
      await tx.matchAuditLog.deleteMany({ where: { matchId: { in: oldMatchIds } } });
      await tx.matchupHistory.deleteMany({ where: { matchId: { in: oldMatchIds } } });
    }
    await tx.bracket.deleteMany({ where: { divisionId: input.divisionId } });
    const bracket = await tx.bracket.create({ data: {
      divisionId: input.divisionId,
      structure: JSON.stringify(proposed.structure),
      format: input.config.format,
    } });
    await tx.match.createMany({ data: proposed.matches.map((match) => ({
      bracketId: bracket.id,
      roundNumber: match.roundNumber,
      matchNumber: match.matchNumber,
      bracketType: match.bracketType,
      competitor1Id: match.competitor1Id,
      competitor2Id: match.competitor2Id,
      status: match.status,
    })) });
    await initializeByes(tx, bracket.id);
    const after = await loadSnapshot(tx, input.divisionId);
    const audit = await tx.tournamentOperationAudit.create({ data: {
      tournamentId: input.tournamentId,
      operationType: 'bracket_reseed',
      operationKey: input.operationKey,
      beforeState: JSON.stringify(snapshot),
      afterState: JSON.stringify(after),
      impactSummary: JSON.stringify({ ...impact, _operation: evidence }),
      reversible: true,
      createdBy: input.approvedBy,
    } });
    return { auditId: audit.id, alreadyApplied: false, impact };
  }, { isolationLevel: 'Serializable' });
}

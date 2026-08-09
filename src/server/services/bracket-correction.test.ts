import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  applyBracketCorrection,
  bracketCorrectionVersion,
  buildBracketCorrectionImpact,
  buildProposedBracketCorrection,
  proposedBracketVersion,
  previewBracketCorrection,
  undoBracketCorrection,
  getBracketCorrectionStatus,
  assertInitialBracketGeneration,
  assertDeterministicCorrectionConfig,
} from './bracket-correction.js';

const snapshot = {
  tournamentId: 'tournament-1',
  divisionId: 'division-1',
  divisionName: 'Junior Sparring',
  assignments: [
    { registrationId: 'r1', seedPosition: 1, firstName: 'Amina', lastName: 'Khan', school: 'North Star' },
    { registrationId: 'r2', seedPosition: 2, firstName: 'Minho', lastName: 'Park', school: 'East Wind' },
  ],
  bracket: {
    id: 'bracket-1', format: 'double_elim', structure: '{"version":1}', updatedAt: '2030-01-01T10:00:00.000Z',
    matches: [
      { id: 'm1', matchNumber: 1, roundNumber: 1, bracketType: 'winners', competitor1Id: 'r1', competitor2Id: 'r2', winnerId: 'r1', score1: '6', score2: '3', status: 'completed', notes: 'clean result' },
      { id: 'm2', matchNumber: 2, roundNumber: 1, bracketType: 'losers', competitor1Id: null, competitor2Id: null, winnerId: null, score1: null, score2: null, status: 'pending', notes: null },
    ],
  },
  matchAuditCount: 2,
  matchupHistoryCount: 1,
  matchAuditRows: [],
  matchupHistoryRows: [],
};

const proposed = {
  format: 'single_elim',
  seedingStrategy: 'school_spread',
  matches: [
    { matchNumber: 1, roundNumber: 1, bracketType: 'winners', competitor1Id: 'r2', competitor2Id: 'r1', status: 'ready' },
  ],
};

describe('bracket correction preview contract', () => {
  it('versions every assignment, competitor label, match result, and history count', () => {
    const version = bracketCorrectionVersion(snapshot);
    expect(bracketCorrectionVersion({ ...snapshot, assignments: [{ ...snapshot.assignments[0], firstName: 'Amira' }, snapshot.assignments[1]] })).not.toBe(version);
    expect(bracketCorrectionVersion({ ...snapshot, bracket: { ...snapshot.bracket, matches: [{ ...snapshot.bracket.matches[0], score1: '7' }, snapshot.bracket.matches[1]] } })).not.toBe(version);
    expect(bracketCorrectionVersion({ ...snapshot, matchAuditCount: 3 })).not.toBe(version);
  });

  it('reports the exact results, history, byes, and pairings a reseed replaces', () => {
    expect(buildBracketCorrectionImpact(snapshot, proposed)).toEqual({
      divisionId: 'division-1',
      divisionLabel: 'Junior Sparring',
      competitorCount: 2,
      oldFormat: 'double_elim',
      newFormat: 'single_elim',
      oldMatchCount: 2,
      newMatchCount: 1,
      completedMatchesRemoved: 1,
      inProgressMatchesBlocked: 0,
      scoredMatchesRemoved: 1,
      notesRemoved: 1,
      matchAuditRowsRemoved: 2,
      matchupHistoryRowsRemoved: 1,
      oldByeCount: 0,
      newByeCount: 0,
      changedFirstRoundPairings: [{
        matchNumber: 1,
        before: ['Amina Khan', 'Minho Park'],
        after: ['Minho Park', 'Amina Khan'],
      }],
      reversible: true,
    });
  });

  it('marks an active match as a hard reseed blocker', () => {
    const active = { ...snapshot, bracket: { ...snapshot.bracket, matches: [{ ...snapshot.bracket.matches[0], status: 'in_progress' }, snapshot.bracket.matches[1]] } };
    expect(buildBracketCorrectionImpact(active, proposed).inProgressMatchesBlocked).toBe(1);
  });

  it('builds a deterministic production bracket proposal without database writes', () => {
    const first = buildProposedBracketCorrection(snapshot, { format: 'double_elim', seedingStrategy: 'school_spread' });
    const second = buildProposedBracketCorrection(snapshot, { format: 'double_elim', seedingStrategy: 'school_spread' });
    expect(first.matches.length).toBeGreaterThan(0);
    expect(proposedBracketVersion(first)).toBe(proposedBracketVersion(second));
    expect(first.structure).toEqual(second.structure);
  });

  it('creates an immutable preview from one serializable snapshot', async () => {
    const database = { $transaction: vi.fn((work: (client: unknown) => unknown) => work({})) };
    const result = await previewBracketCorrection(database as never, 'division-1', { format: 'single_elim', seedingStrategy: 'school_spread' }, 'operation-1', { loadSnapshot: vi.fn().mockResolvedValue(snapshot) });
    expect(result.operationKey).toBe('operation-1');
    expect(result.proposedConfig).toEqual({ format: 'single_elim', seedingStrategy: 'school_spread' });
    expect(result.expectedInputVersion).toBe(bracketCorrectionVersion(snapshot));
    expect(result.expectedResultVersion).toBe(proposedBracketVersion(result.proposed));
    expect(result.impact.completedMatchesRemoved).toBe(1);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale or active bracket before deleting any records', async () => {
    const deleteMany = vi.fn();
    const active = { ...snapshot, bracket: { ...snapshot.bracket, matches: [{ ...snapshot.bracket.matches[0], status: 'in_progress' }, snapshot.bracket.matches[1]] } };
    const database = { $transaction: vi.fn((work: (tx: unknown) => unknown) => work({
      tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue(null) },
      bracket: { deleteMany },
    })) };
    await expect(applyBracketCorrection(database as never, {
      tournamentId: 'tournament-1', divisionId: 'division-1', config: { format: 'single_elim', seedingStrategy: 'school_spread' },
      expectedInputVersion: bracketCorrectionVersion(active), expectedResultVersion: proposedBracketVersion(proposed), operationKey: 'operation-1', approvedBy: 'director-1',
    }, { loadSnapshot: vi.fn().mockResolvedValue(active) })).rejects.toThrow('Bracket cannot be reseeded while a match is in progress');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('replaces the bracket, histories, initializes byes, and writes one audit atomically', async () => {
    const clean = { ...snapshot, bracket: { ...snapshot.bracket, matches: snapshot.bracket.matches.map((match) => ({ ...match, status: 'ready', winnerId: null, score1: null, score2: null, notes: null })) }, matchAuditCount: 0, matchupHistoryCount: 0 };
    const proposal = buildProposedBracketCorrection(clean, { format: 'single_elim', seedingStrategy: 'school_spread' });
    const after = { ...clean, bracket: { id: 'new-bracket', format: 'single_elim', structure: JSON.stringify(proposal.structure), updatedAt: '2030-01-01T11:00:00.000Z', matches: proposal.matches }, matchAuditCount: 0, matchupHistoryCount: 0 };
    const initializeByes = vi.fn().mockResolvedValue(0);
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue(null), create: auditCreate },
      matchAuditLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      matchupHistory: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      bracket: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({ id: 'new-bracket' }) },
      match: { createMany: vi.fn().mockResolvedValue({ count: proposal.matches.length }) },
    };
    const database = { $transaction: vi.fn((work: (client: unknown) => unknown) => work(tx)) };
    const loadSnapshot = vi.fn().mockResolvedValueOnce(clean).mockResolvedValueOnce(after);
    await expect(applyBracketCorrection(database as never, {
      tournamentId: 'tournament-1', divisionId: 'division-1', config: { format: 'single_elim', seedingStrategy: 'school_spread' },
      expectedInputVersion: bracketCorrectionVersion(clean), expectedResultVersion: proposedBracketVersion(proposal), operationKey: 'operation-1', approvedBy: 'director-1',
    }, { loadSnapshot, initializeByes })).resolves.toEqual({ auditId: 'audit-1', alreadyApplied: false, impact: buildBracketCorrectionImpact(clean, proposal) });
    expect(initializeByes).toHaveBeenCalledWith(tx, 'new-bracket');
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ operationType: 'bracket_reseed', operationKey: 'operation-1', createdBy: 'director-1', reversible: true }) });
  });

  it('restores the exact snapshotted bracket and histories only when no later scoring occurred', async () => {
    const before = { ...snapshot, matchAuditRows: [{ id: 'log-1', matchId: 'm1' }], matchupHistoryRows: [{ id: 'history-1', matchId: 'm1' }] };
    const current = { ...snapshot, bracket: { ...snapshot.bracket, id: 'new-bracket', updatedAt: '2030-01-01T11:00:00.000Z', matches: snapshot.bracket.matches.map((match) => ({ ...match, id: `new-${match.id}`, status: 'ready', winnerId: null, score1: null, score2: null })) }, matchAuditCount: 0, matchupHistoryCount: 0, matchAuditRows: [], matchupHistoryRows: [] };
    const auditUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue({ id: 'audit-1', tournamentId: 'tournament-1', operationType: 'bracket_reseed', reversible: true, undoneAt: null, beforeState: JSON.stringify(before), afterState: JSON.stringify(current) }), updateMany: auditUpdate },
      matchAuditLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      matchupHistory: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      bracket: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({ id: 'bracket-1' }) },
      match: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const database = { $transaction: vi.fn((work: (client: unknown) => unknown) => work(tx)) };
    await expect(undoBracketCorrection(database as never, 'tournament-1', 'division-1', 'audit-1', 'director-1', new Date('2030-01-01T12:00:00Z'), { loadSnapshot: vi.fn().mockResolvedValue(current) })).resolves.toBeUndefined();
    expect(tx.bracket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'bracket-1', divisionId: 'division-1' }) });
    expect(tx.matchAuditLog.createMany).toHaveBeenCalledWith({ data: before.matchAuditRows });
    expect(tx.matchupHistory.createMany).toHaveBeenCalledWith({ data: before.matchupHistoryRows });
    expect(auditUpdate).toHaveBeenCalledWith({ where: { id: 'audit-1', undoneAt: null }, data: { undoneAt: new Date('2030-01-01T12:00:00Z'), undoneBy: 'director-1' } });
  });

  it('returns operation status only for the bound tournament and division', async () => {
    const database = { tournamentOperationAudit: { findUnique: vi.fn().mockResolvedValue({
      id: 'audit-1', tournamentId: 'tournament-1', operationType: 'bracket_reseed', operationKey: 'operation-1',
      beforeState: JSON.stringify(snapshot), createdAt: new Date('2030-01-01T10:00:00Z'), undoneAt: null,
    }) } };
    await expect(getBracketCorrectionStatus(database as never, 'tournament-1', 'division-1', 'operation-1')).resolves.toEqual({ auditId: 'audit-1', applied: true, undone: false, createdAt: '2030-01-01T10:00:00.000Z' });
    await expect(getBracketCorrectionStatus(database as never, 'tournament-1', 'other-division', 'operation-1')).resolves.toBeNull();
  });

  it('refuses the legacy destructive endpoint once a bracket exists', () => {
    expect(() => assertInitialBracketGeneration({ id: 'existing-bracket' })).toThrow('Existing brackets must use the correction preview');
    expect(() => assertInitialBracketGeneration(null)).not.toThrow();
  });

  it('rejects nondeterministic correction strategies before previewing', () => {
    expect(() => assertDeterministicCorrectionConfig({ format: 'double_elim', seedingStrategy: 'fairness_optimized' })).toThrow('deterministic seeding strategy');
    expect(() => assertDeterministicCorrectionConfig({ format: 'double_elim', seedingStrategy: 'school_spread' })).not.toThrow();
  });
});

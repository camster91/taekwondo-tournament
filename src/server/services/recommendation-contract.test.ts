import { describe, expect, it, vi } from 'vitest';
import {
  approveRecommendation,
  applyApprovedRecommendation,
  createRecommendation,
  rejectRecommendation,
} from './recommendation-contract';

const proposed = {
  tournamentId: 'tournament-1', recommendationType: 'division_merge',
  inputSnapshot: { registrations: ['r1', 'r2'] },
  explanation: 'Merge two undersized adjacent divisions.',
  constraintsConsidered: ['pinned competitors', 'age bands', 'weight proximity'],
  confidence: 0.82, warnings: ['Director must review the age exception.'],
  proposedDiff: { move: [{ registrationId: 'r2', from: 'd2', to: 'd1' }] },
  validationResult: { valid: true, validator: 'division-rules-v1', checkedAt: '2030-01-01T12:00:00.000Z', errors: [] },
  createdBy: 'assistant-service',
};
const validator = vi.fn(async () => ({ valid: true, validator: 'division-rules-v1', inputVersion: 'snapshot-v1', errors: [] as string[] }));

const db = () => {
  const store: any = {
    recommendation: {
    create: vi.fn(async ({ data }) => ({ id: 'rec-1', status: 'proposed', createdAt: new Date('2030-01-01'), ...data })),
    findUnique: vi.fn(), update: vi.fn(),
    },
    tournamentOperationAudit: { create: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  };
  store.$transaction = vi.fn(async (fn: any) => fn(store));
  return store;
};

describe('recommendation contract', () => {
  it('persists every required proposal field and immutable validation evidence', async () => {
    const prisma = db();
    const result = await createRecommendation(prisma as never, proposed, validator);
    expect(result.status).toBe('proposed');
    expect(prisma.recommendation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recommendationType: 'division_merge', inputSnapshot: JSON.stringify(proposed.inputSnapshot),
      constraintsConsidered: JSON.stringify(proposed.constraintsConsidered), proposedDiff: JSON.stringify(proposed.proposedDiff),
      validationResult: expect.any(String), confidence: 0.82,
    }) });
    expect(JSON.parse(prisma.recommendation.create.mock.calls[0][0].data.validationResult)).toMatchObject({ validator: 'division-rules-v1', inputVersion: 'snapshot-v1', valid: true });
  });

  it('refuses proposals without deterministic validation or complete explanations', async () => {
    const prisma = db();
    await expect(createRecommendation(prisma as never, { ...proposed, explanation: '' }, validator)).rejects.toThrow('explanation');
    await expect(createRecommendation(prisma as never, proposed, vi.fn(async () => ({ valid: true, validator: '', inputVersion: 'v1', errors: [] })))).rejects.toThrow('validator');
    expect(prisma.recommendation.create).not.toHaveBeenCalled();
  });

  it('uses server-selected validation evidence instead of creator-supplied claims', async () => {
    const prisma = db();
    const serverValidator = vi.fn(async () => ({ valid: false, validator: 'trusted-v2', inputVersion: 'current-v2', errors: ['State is stale'] }));
    await createRecommendation(prisma as never, proposed, serverValidator);
    const stored = JSON.parse(prisma.recommendation.create.mock.calls[0][0].data.validationResult);
    expect(stored).toMatchObject({ valid: false, validator: 'trusted-v2', inputVersion: 'current-v2', errors: ['State is stale'] });
    expect(stored.checkedAt).toMatch(/Z$/);
  });

  it('requires a named human approver and a valid deterministic result', async () => {
    const prisma = db();
    prisma.recommendation.findUnique.mockResolvedValue({ id: 'rec-1', status: 'proposed', inputSnapshot: '{}', proposedDiff: '{}', validationResult: JSON.stringify({ valid: true, validator: 'division-rules-v1', inputVersion: 'snapshot-v1', errors: [] }) });
    const invalid = vi.fn(async () => ({ valid: false, validator: 'division-rules-v1', inputVersion: 'snapshot-v1', errors: ['Pinned competitor would move'] }));
    await expect(approveRecommendation(prisma as never, 'rec-1', 'director-1', invalid)).rejects.toThrow('deterministic validation');
    await expect(approveRecommendation(prisma as never, 'rec-1', '', validator)).rejects.toThrow('approval identity');
  });

  it('applies only an approved recommendation and records audit plus undo reference atomically', async () => {
    const prisma = db();
    const txRecommendation = { findUnique: vi.fn(async () => ({ id: 'rec-1', tournamentId: 'tournament-1', recommendationType: 'division_merge', status: 'approved', proposedDiff: '{}', approvedBy: 'director-1' })), update: vi.fn() };
    const txAudit = { create: vi.fn(async () => ({ id: 'audit-1' })) };
    prisma.$transaction.mockImplementation(async (fn) => fn({ recommendation: txRecommendation, tournamentOperationAudit: txAudit, $queryRawUnsafe: vi.fn() }));
    const apply = vi.fn(async () => ({ appliedResult: { moved: 1 }, undoReference: 'division-backup-1', beforeState: { divisions: 2 }, afterState: { divisions: 1 } }));
    txRecommendation.findUnique.mockResolvedValue({ ...await txRecommendation.findUnique(), inputSnapshot: '{}', validationResult: JSON.stringify({ valid: true, validator: 'division-rules-v1', inputVersion: 'snapshot-v1' }) });
    const result = await applyApprovedRecommendation(prisma as never, 'rec-1', 'director-1', apply, validator);
    expect(result).toMatchObject({ appliedResult: { moved: 1 }, undoReference: 'division-backup-1' });
    expect(txAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdBy: 'director-1', reversible: true }) });
    expect(txRecommendation.update).toHaveBeenCalledWith({ where: { id: 'rec-1' }, data: expect.objectContaining({ status: 'applied', undoReference: 'division-backup-1' }) });
  });

  it('records explicit rejection and never calls an apply callback', async () => {
    const prisma = db();
    prisma.recommendation.findUnique.mockResolvedValue({ id: 'rec-1', status: 'proposed' });
    prisma.recommendation.update.mockResolvedValue({ id: 'rec-1', status: 'rejected' });
    await expect(rejectRecommendation(prisma as never, 'rec-1', 'director-1', 'Unsafe age spread')).resolves.toMatchObject({ status: 'rejected' });
    expect(prisma.recommendation.update).toHaveBeenCalledWith({ where: { id: 'rec-1' }, data: expect.objectContaining({ rejectedBy: 'director-1', rejectionReason: 'Unsafe age spread' }) });
  });

  it('returns canonical applied evidence without executing the mutation twice', async () => {
    const prisma = db();
    const txRecommendation = { findUnique: vi.fn(async () => ({
      id: 'rec-1', tournamentId: 'tournament-1', recommendationType: 'division_merge', status: 'applied',
      appliedResult: JSON.stringify({ moved: 1 }), undoReference: 'backup-1', operationAuditId: 'audit-1',
    })), update: vi.fn() };
    prisma.$transaction.mockImplementation(async (fn) => fn({ recommendation: txRecommendation, tournamentOperationAudit: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'audit-1', undoneAt: null }) }, $queryRawUnsafe: vi.fn() }));
    const apply = vi.fn();
    await expect(applyApprovedRecommendation(prisma as never, 'rec-1', 'director-2', apply, validator)).resolves.toEqual({
      appliedResult: { moved: 1 }, undoReference: 'backup-1', auditId: 'audit-1', alreadyApplied: true,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('never reports an undone recommendation as currently applied', async () => {
    const prisma = db();
    const txRecommendation = { findUnique: vi.fn(async () => ({
      id: 'rec-1', tournamentId: 'tournament-1', recommendationType: 'schedule_optimization_v1', status: 'applied',
      appliedResult: JSON.stringify({ moved: 1 }), undoReference: 'schedule-recommendation:rec-1', operationAuditId: 'audit-1',
    })), update: vi.fn() };
    prisma.$transaction.mockImplementation(async (fn) => fn({
      recommendation: txRecommendation,
      tournamentOperationAudit: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'audit-1', undoneAt: new Date() }) },
      $queryRawUnsafe: vi.fn(),
    }));
    await expect(applyApprovedRecommendation(prisma as never, 'rec-1', 'director-2', vi.fn(), validator))
      .rejects.toThrow('has been undone');
  });

  it('refuses application when current deterministic input no longer matches approval', async () => {
    const prisma = db();
    const txRecommendation = { findUnique: vi.fn(async () => ({
      id: 'rec-1', tournamentId: 'tournament-1', recommendationType: 'division_merge', status: 'approved',
      inputSnapshot: '{}', proposedDiff: '{}', validationResult: JSON.stringify({ valid: true, validator: 'trusted-v1', inputVersion: 'old' }),
    })), update: vi.fn() };
    prisma.$transaction.mockImplementation(async (fn) => fn({ recommendation: txRecommendation, tournamentOperationAudit: { create: vi.fn() }, $queryRawUnsafe: vi.fn() }));
    const apply = vi.fn();
    const changed = vi.fn(async () => ({ valid: true, validator: 'trusted-v1', inputVersion: 'new', errors: [] }));
    await expect(applyApprovedRecommendation(prisma as never, 'rec-1', 'director-1', apply, changed)).rejects.toThrow('changed since validation');
    expect(apply).not.toHaveBeenCalled();
  });
});

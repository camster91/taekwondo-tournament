import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { approveRecommendation, applyApprovedRecommendation, createRecommendation, rejectRecommendation } from './recommendation-contract';

const databaseUrl = process.env.RECOMMENDATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
let prisma: PrismaClient;
const validator = async () => ({ valid: true, validator: 'deterministic-test-v1', inputVersion: 'fixture-v1', errors: [] as string[] });

integration('recommendation contract against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) throw new Error('RECOMMENDATION_DATABASE_URL must target a local *_test or *_e2e database');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Recommendations', slug: `recommendations-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Recommendations', date: new Date('2030-01-01') } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('persists proposal, approval, application audit, undo reference, and canonical retry', async () => {
    const recommendation = await createRecommendation(prisma as never, {
      tournamentId, recommendationType: 'division_merge', inputSnapshot: { registrations: ['r1'] },
      explanation: 'Merge an undersized category.', constraintsConsidered: ['manual pins'], confidence: 0.75,
      warnings: [], proposedDiff: { move: ['r1'] },
      createdBy: 'assistant-test',
    }, validator);
    await approveRecommendation(prisma as never, recommendation.id, 'director-test', validator);
    let applyCalls = 0;
    const apply = async () => { applyCalls += 1; return { appliedResult: { moved: 1 }, undoReference: 'backup-test', beforeState: { count: 2 }, afterState: { count: 1 } }; };
    const first = await applyApprovedRecommendation(prisma as never, recommendation.id, 'director-test', apply, validator);
    const retry = await applyApprovedRecommendation(prisma as never, recommendation.id, 'director-test', apply, validator);
    expect(applyCalls).toBe(1);
    expect(retry).toEqual({ ...first, alreadyApplied: true });
    const stored = await prisma.recommendation.findUniqueOrThrow({ where: { id: recommendation.id } });
    expect(stored).toMatchObject({ status: 'applied', approvedBy: 'director-test', appliedBy: 'director-test', undoReference: 'backup-test', operationAuditId: first.auditId });
    await expect(prisma.tournamentOperationAudit.findUnique({ where: { id: first.auditId } })).resolves.toMatchObject({ tournamentId, operationType: 'recommendation:division_merge', reversible: true });
  });

  it('rolls back every lifecycle write when deterministic application fails', async () => {
    const recommendation = await createRecommendation(prisma as never, {
      tournamentId, recommendationType: 'division_split', inputSnapshot: {}, explanation: 'Split an unsafe category.',
      constraintsConsidered: ['age spread'], confidence: 0.9, warnings: [], proposedDiff: {},
      createdBy: 'assistant-test',
    }, validator);
    await approveRecommendation(prisma as never, recommendation.id, 'director-test', validator);
    await expect(applyApprovedRecommendation(prisma as never, recommendation.id, 'director-test', async () => { throw new Error('forced deterministic failure'); }, validator)).rejects.toThrow('forced deterministic failure');
    await expect(prisma.recommendation.findUnique({ where: { id: recommendation.id } })).resolves.toMatchObject({ status: 'approved', appliedAt: null, operationAuditId: null });
    await expect(prisma.tournamentOperationAudit.count({ where: { tournamentId, operationType: 'recommendation:division_split' } })).resolves.toBe(0);
  });

  it('converges concurrent apply attempts on one audited mutation', async () => {
    const recommendation = await createRecommendation(prisma as never, {
      tournamentId, recommendationType: 'schedule_balance', inputSnapshot: {}, explanation: 'Balance ring work.',
      constraintsConsidered: ['manual locks'], confidence: 0.8, warnings: [], proposedDiff: {},
      createdBy: 'assistant-test',
    }, validator);
    await approveRecommendation(prisma as never, recommendation.id, 'director-test', validator);
    let applyCalls = 0;
    const apply = async () => {
      applyCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { appliedResult: { balanced: true }, undoReference: 'backup-concurrent', afterState: { balanced: true } };
    };
    const outcomes = await Promise.all([
      applyApprovedRecommendation(prisma as never, recommendation.id, 'director-a', apply, validator),
      applyApprovedRecommendation(prisma as never, recommendation.id, 'director-b', apply, validator),
    ]);
    expect(applyCalls).toBe(1);
    expect(new Set(outcomes.map((outcome) => outcome.auditId))).toEqual(new Set([outcomes[0].auditId]));
  });

  it('allows exactly one concurrent approve-or-reject decision', async () => {
    const recommendation = await createRecommendation(prisma as never, {
      tournamentId, recommendationType: 'division_exception', inputSnapshot: {}, explanation: 'Review one exception.',
      constraintsConsidered: ['manual pins'], confidence: 0.6, warnings: [], proposedDiff: {}, createdBy: 'assistant-test',
    }, validator);
    const outcomes = await Promise.allSettled([
      approveRecommendation(prisma as never, recommendation.id, 'director-approve', validator),
      rejectRecommendation(prisma as never, recommendation.id, 'director-reject', 'Not safe'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const stored = await prisma.recommendation.findUniqueOrThrow({ where: { id: recommendation.id } });
    expect(['approved', 'rejected']).toContain(stored.status);
    expect(Boolean(stored.approvedBy) && Boolean(stored.rejectedBy)).toBe(false);
  });
});

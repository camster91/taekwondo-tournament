import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, Recommendation } from '@prisma/client';

export interface RecommendationProposal {
  tournamentId: string;
  recommendationType: string;
  inputSnapshot: unknown;
  explanation: string;
  constraintsConsidered: string[];
  confidence: number;
  warnings: string[];
  proposedDiff: unknown;
  createdBy?: string;
}

export interface DeterministicValidationEvidence {
  valid: boolean;
  validator: string;
  inputVersion: string;
  errors: string[];
}

export type RecommendationValidationInput = Pick<RecommendationProposal, 'tournamentId' | 'recommendationType' | 'inputSnapshot' | 'proposedDiff'>;

export type RecommendationValidator = (
  db: PrismaClient | Prisma.TransactionClient,
  recommendation: RecommendationValidationInput,
) => Promise<DeterministicValidationEvidence>;

interface ApplyEvidence {
  appliedResult: unknown;
  undoReference?: string | null;
  beforeState?: unknown;
  afterState: unknown;
}

const nonEmpty = (value: string, field: string) => {
  if (!value.trim()) throw new Error(`Recommendation ${field} is required`);
};

function validateProposal(proposal: RecommendationProposal) {
  nonEmpty(proposal.tournamentId, 'tournament');
  nonEmpty(proposal.recommendationType, 'type');
  nonEmpty(proposal.explanation, 'explanation');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) throw new Error('Recommendation confidence must be between 0 and 1');
  if (!Array.isArray(proposal.constraintsConsidered) || proposal.constraintsConsidered.length === 0) throw new Error('Recommendation constraints are required');
  if (!Array.isArray(proposal.warnings)) throw new Error('Recommendation warnings must be an array');
}

async function runValidation(db: PrismaClient | Prisma.TransactionClient, proposal: RecommendationValidationInput, validator: RecommendationValidator) {
  const evidence = await validator(db, proposal);
  nonEmpty(evidence.validator, 'validator'); nonEmpty(evidence.inputVersion, 'input version');
  if (typeof evidence.valid !== 'boolean' || !Array.isArray(evidence.errors)) throw new Error('Deterministic validation returned invalid evidence');
  return { ...evidence, checkedAt: new Date().toISOString() };
}

async function lockRecommendation(db: Prisma.TransactionClient, recommendationId: string) {
  await db.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1))', recommendationId);
}

export async function createRecommendation(prisma: PrismaClient, proposal: RecommendationProposal, validator: RecommendationValidator) {
  validateProposal(proposal);
  if (!validator) throw new Error('A server-selected deterministic validator is required');
  const validationResult = await runValidation(prisma, proposal, validator);
  return prisma.recommendation.create({ data: {
    tournamentId: proposal.tournamentId,
    recommendationType: proposal.recommendationType,
    inputSnapshot: JSON.stringify(proposal.inputSnapshot),
    explanation: proposal.explanation,
    constraintsConsidered: JSON.stringify(proposal.constraintsConsidered),
    confidence: proposal.confidence,
    warnings: JSON.stringify(proposal.warnings),
    proposedDiff: JSON.stringify(proposal.proposedDiff),
    validationResult: JSON.stringify(validationResult),
    status: 'proposed', createdBy: proposal.createdBy || null,
  } });
}

export async function approveRecommendation(prisma: PrismaClient, recommendationId: string, approvedBy: string, validator: RecommendationValidator) {
  nonEmpty(approvedBy, 'approval identity');
  if (!validator) throw new Error('A server-selected deterministic validator is required');
  return prisma.$transaction(async (tx) => {
    await lockRecommendation(tx, recommendationId);
    const recommendation = await tx.recommendation.findUnique({ where: { id: recommendationId } });
    if (!recommendation || recommendation.status !== 'proposed') throw new Error('Recommendation is not awaiting approval');
    const proposal: RecommendationValidationInput = {
      tournamentId: recommendation.tournamentId, recommendationType: recommendation.recommendationType,
      inputSnapshot: JSON.parse(recommendation.inputSnapshot), proposedDiff: JSON.parse(recommendation.proposedDiff),
    };
    const previous = JSON.parse(recommendation.validationResult) as DeterministicValidationEvidence;
    const validation = await runValidation(tx, proposal, validator);
    if (!validation.valid) throw new Error('Recommendation failed deterministic validation');
    if (validation.validator !== previous.validator || validation.inputVersion !== previous.inputVersion) throw new Error('Recommendation inputs changed since validation');
    return tx.recommendation.update({ where: { id: recommendationId }, data: { status: 'approved', approvedBy, approvedAt: new Date(), validationResult: JSON.stringify(validation) } });
  });
}

export async function rejectRecommendation(prisma: PrismaClient, recommendationId: string, rejectedBy: string, reason: string) {
  nonEmpty(rejectedBy, 'rejection identity'); nonEmpty(reason, 'rejection reason');
  return prisma.$transaction(async (tx) => {
    await lockRecommendation(tx, recommendationId);
    const recommendation = await tx.recommendation.findUnique({ where: { id: recommendationId } });
    if (!recommendation || recommendation.status !== 'proposed') throw new Error('Recommendation is not awaiting review');
    return tx.recommendation.update({ where: { id: recommendationId }, data: { status: 'rejected', rejectedBy, rejectedAt: new Date(), rejectionReason: reason } });
  });
}

export async function applyApprovedRecommendation(
  prisma: PrismaClient,
  recommendationId: string,
  appliedBy: string,
  apply: (tx: Prisma.TransactionClient, recommendation: Recommendation) => Promise<ApplyEvidence>,
  validator: RecommendationValidator,
) {
  nonEmpty(appliedBy, 'application identity');
  if (!validator) throw new Error('A server-selected deterministic validator is required');
  return prisma.$transaction(async (tx) => {
    // Serialize the lifecycle for this recommendation before inspecting its
    // status. The callback may write several domain rows and must run once.
    await lockRecommendation(tx, recommendationId);
    const recommendation = await tx.recommendation.findUnique({ where: { id: recommendationId } });
    if (recommendation?.status === 'applied') {
      return {
        appliedResult: JSON.parse(recommendation.appliedResult || 'null'),
        undoReference: recommendation.undoReference || null,
        auditId: recommendation.operationAuditId,
        alreadyApplied: true,
      };
    }
    if (!recommendation || recommendation.status !== 'approved') throw new Error('Recommendation requires explicit approval before application');
    const previous = JSON.parse(recommendation.validationResult) as DeterministicValidationEvidence;
    const current = await runValidation(tx, {
      tournamentId: recommendation.tournamentId, recommendationType: recommendation.recommendationType,
      inputSnapshot: JSON.parse(recommendation.inputSnapshot), proposedDiff: JSON.parse(recommendation.proposedDiff),
    }, validator);
    if (!current.valid) throw new Error('Recommendation failed deterministic validation');
    if (current.validator !== previous.validator || current.inputVersion !== previous.inputVersion) throw new Error('Recommendation inputs changed since validation');
    const evidence = await apply(tx, recommendation);
    const audit = await tx.tournamentOperationAudit.create({ data: {
      tournamentId: recommendation.tournamentId,
      operationType: `recommendation:${recommendation.recommendationType}`,
      operationKey: `recommendation:${recommendation.id}:${randomUUID()}`,
      beforeState: evidence.beforeState === undefined ? null : JSON.stringify(evidence.beforeState),
      afterState: JSON.stringify(evidence.afterState),
      impactSummary: JSON.stringify({ recommendationId, appliedResult: evidence.appliedResult }),
      reversible: Boolean(evidence.undoReference), createdBy: appliedBy,
    } });
    await tx.recommendation.update({ where: { id: recommendationId }, data: {
      status: 'applied', appliedBy, appliedAt: new Date(), appliedResult: JSON.stringify(evidence.appliedResult),
      undoReference: evidence.undoReference || null, operationAuditId: audit.id, validationResult: JSON.stringify(current),
    } });
    return { appliedResult: evidence.appliedResult, undoReference: evidence.undoReference || null, auditId: audit.id, alreadyApplied: false };
  });
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { approveRecommendation } from './recommendation-contract.js';
import {
  applyDivisionRecommendation,
  createDivisionRecommendation,
  validateDivisionRecommendation,
} from './division-recommendations.js';

const databaseUrl = process.env.RECOMMENDATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
const pinnedCompetitorId = randomUUID();
const generatedCompetitorId = randomUUID();
let prisma: PrismaClient;
let pinnedAssignmentId: string;

integration('division recommendations against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('RECOMMENDATION_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Division Recommendations', slug: `division-recommendations-${organizationId}` } });
    await prisma.tournament.create({ data: { id: tournamentId, organizationId, name: '[E2E] Division Recommendations', date: new Date('2030-01-01') } });
    await prisma.competitor.createMany({ data: [
      { id: pinnedCompetitorId, firstName: 'Pinned', lastName: 'Athlete', gender: 'F', dateOfBirth: new Date('2020-01-01'), belt: 'Yellow' },
      { id: generatedCompetitorId, firstName: 'Generated', lastName: 'Athlete', gender: 'F', dateOfBirth: new Date('2020-01-01'), belt: 'Yellow' },
    ] });
    const pinnedRegistration = await prisma.registration.create({ data: { tournamentId, competitorId: pinnedCompetitorId, patterns: true, ageAtTournament: 10 } });
    await prisma.registration.create({ data: { tournamentId, competitorId: generatedCompetitorId, patterns: true, ageAtTournament: 10 } });
    const pinnedDivision = await prisma.division.create({ data: {
      tournamentId, name: 'Director pinned division', beltLevel: 'CB', gender: 'F', eventType: 'patterns', ageMin: 10, ageMax: 10,
    } });
    pinnedAssignmentId = (await prisma.divisionAssignment.create({ data: { divisionId: pinnedDivision.id, registrationId: pinnedRegistration.id, manualOverride: true } })).id;
    await prisma.division.create({ data: {
      tournamentId, name: 'Replaceable sparse division', beltLevel: 'CB', gender: 'F', eventType: 'patterns', ageMin: 10, ageMax: 10,
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.competitor.deleteMany({ where: { id: { in: [pinnedCompetitorId, generatedCompetitorId] }, registrations: { none: {} } } });
    await prisma.$disconnect();
  });

  it('applies only after approval, preserves manual placement, and atomically stores a restorable backup', async () => {
    const proposal = await createDivisionRecommendation(prisma, tournamentId, 'assistant-test');
    await expect(applyDivisionRecommendation(prisma, proposal.id, 'director-test')).rejects.toThrow('requires explicit approval');
    await approveRecommendation(prisma, proposal.id, 'director-test', validateDivisionRecommendation);
    const applied = await applyDivisionRecommendation(prisma, proposal.id, 'director-test');

    expect(applied).toMatchObject({ alreadyApplied: false, undoReference: null });
    const divisions = await prisma.division.findMany({ where: { tournamentId }, include: { assignments: true } });
    expect(divisions.find((division) => division.name === 'Director pinned division')?.assignments).toEqual([
      expect.objectContaining({ manualOverride: true }),
    ]);
    expect(divisions.some((division) => division.name === 'Replaceable sparse division')).toBe(false);
    expect(divisions.flatMap((division) => division.assignments).some((assignment) => assignment.registrationId)).toBe(true);
    await expect(prisma.backupState.findUnique({ where: { tournamentId } })).resolves.toMatchObject({ tournamentId });
    await expect(prisma.recommendation.findUnique({ where: { id: proposal.id } })).resolves.toMatchObject({ status: 'applied', appliedBy: 'director-test' });
  });

  it('waits for a concurrent competitor edit and then rejects the stale approved proposal', async () => {
    const proposal = await createDivisionRecommendation(prisma, tournamentId, 'assistant-test');
    await approveRecommendation(prisma, proposal.id, 'director-test', validateDivisionRecommendation);
    const competitorWriter = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    let release!: () => void;
    let locked!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const writer = competitorWriter.$transaction(async (tx) => {
      await tx.competitor.update({ where: { id: generatedCompetitorId }, data: { belt: 'Blue' } });
      locked();
      await releasePromise;
    });
    await lockedPromise;
    let settled = false;
    const outcome = applyDivisionRecommendation(prisma, proposal.id, 'director-test')
      .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    release();
    await writer;
    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : String(result.error)).toContain('inputs changed');
    await prisma.competitor.update({ where: { id: generatedCompetitorId }, data: { belt: 'Yellow' } });
    await competitorWriter.$disconnect();
  });

  it('waits for a concurrent manual-override edit and then rejects the stale approved proposal', async () => {
    const proposal = await createDivisionRecommendation(prisma, tournamentId, 'assistant-test');
    await approveRecommendation(prisma, proposal.id, 'director-test', validateDivisionRecommendation);
    const assignmentWriter = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    let release!: () => void;
    let locked!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const writer = assignmentWriter.$transaction(async (tx) => {
      await tx.divisionAssignment.update({ where: { id: pinnedAssignmentId }, data: { manualOverride: false } });
      locked();
      await releasePromise;
    });
    await lockedPromise;
    let settled = false;
    const outcome = applyDivisionRecommendation(prisma, proposal.id, 'director-test')
      .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    release();
    await writer;
    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : String(result.error)).toContain('inputs changed');
    await prisma.divisionAssignment.update({ where: { id: pinnedAssignmentId }, data: { manualOverride: true } });
    await assignmentWriter.$disconnect();
  });
});

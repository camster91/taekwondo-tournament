import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { approveRecommendation } from './recommendation-contract.js';
import {
  applyScheduleOptimizationRecommendation,
  createScheduleOptimizationRecommendation,
  saveScheduleOperationalConditions,
  saveScheduleDivisionLock,
  undoScheduleOptimizationRecommendation,
  validateScheduleOptimizationRecommendation,
} from './schedule-optimization-recommendations.js';
import { readCanonicalSchedule } from './canonical-schedule.js';

const databaseUrl = process.env.RECOMMENDATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const organizationId = randomUUID();
const tournamentId = randomUUID();
const competitorId = randomUUID();
const foreignTournamentId = randomUUID();
const foreignIncidentId = randomUUID();
const resolvedIncidentId = randomUUID();
const activeIncidentId = randomUUID();
let prisma: PrismaClient;

integration('schedule optimization recommendations against disposable Postgres', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\/[^?]*(?:_test|_e2e)(?:\?|$)/.test(databaseUrl!)) {
      throw new Error('RECOMMENDATION_DATABASE_URL must target a local *_test or *_e2e database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await prisma.organization.create({ data: { id: organizationId, name: '[E2E] Schedule Optimization', slug: `schedule-optimization-${organizationId}` } });
    await prisma.tournament.create({ data: {
      id: tournamentId, organizationId, name: '[E2E] Schedule Optimization', date: new Date('2030-01-01'),
      settings: JSON.stringify({ schedule: { startTime: '09:00', endTime: '17:00', ringCount: 2, matchDurationMinutes: { patterns: 3, sparring: 5 }, breakBetweenDivisions: 5 } }),
    } });
    await prisma.tournament.create({ data: { id: foreignTournamentId, organizationId, name: '[E2E] Foreign Schedule', date: new Date('2030-01-02') } });
    await prisma.incident.create({ data: {
      id: foreignIncidentId, tournamentId: foreignTournamentId, type: 'medical', severity: 'serious', description: 'Foreign pause',
    } });
    await prisma.incident.create({ data: {
      id: resolvedIncidentId, tournamentId, type: 'equipment', severity: 'minor', description: 'Resolved pause', actionTaken: 'continued',
    } });
    await prisma.incident.create({ data: {
      id: activeIncidentId, tournamentId, type: 'equipment', severity: 'minor', description: 'Active ring pause',
    } });
    await prisma.competitor.create({ data: {
      id: competitorId, firstName: 'Amina', lastName: 'Schedule', gender: 'F', dateOfBirth: new Date('2020-01-01'), belt: 'Yellow', schoolDojang: 'North Star',
    } });
    const registration = await prisma.registration.create({ data: { tournamentId, competitorId, patterns: true, ageAtTournament: 10 } });
    for (const [index, name] of ['Patterns Alpha', 'Patterns Beta'].entries()) {
      const division = await prisma.division.create({ data: {
        tournamentId, name, beltLevel: 'CB', gender: 'F', eventType: 'patterns', ageMin: 10, ageMax: 10, displayOrder: index,
      } });
      await prisma.divisionAssignment.create({ data: { divisionId: division.id, registrationId: registration.id } });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tournament.deleteMany({ where: { id: tournamentId, organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.competitor.deleteMany({ where: { id: competitorId, registrations: { none: {} } } });
    await prisma.$disconnect();
  });

  it('persists exactly the approved rows, replays idempotently, and restores the audited before-state', async () => {
    const beforeSettings = (await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).settings;
    const proposal = await createScheduleOptimizationRecommendation(prisma, tournamentId, 'assistant-test', new Date('2026-08-09T14:00:00Z'));
    await expect(applyScheduleOptimizationRecommendation(prisma, proposal.id, 'director-test')).rejects.toThrow('requires explicit approval');
    await approveRecommendation(prisma, proposal.id, 'director-test', validateScheduleOptimizationRecommendation);
    const applied = await applyScheduleOptimizationRecommendation(prisma, proposal.id, 'director-test');
    const retry = await applyScheduleOptimizationRecommendation(prisma, proposal.id, 'director-test');

    expect(applied).toMatchObject({ alreadyApplied: false, undoReference: `schedule-recommendation:${proposal.id}` });
    expect(retry).toMatchObject({ alreadyApplied: true, auditId: applied.auditId });
    const afterSettings = (await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).settings;
    const canonical = readCanonicalSchedule(afterSettings);
    expect(canonical?.rows).toHaveLength(2);
    expect(new Set(canonical?.rows.map((row) => row.startMinutes)).size).toBe(2);

    await undoScheduleOptimizationRecommendation(prisma, tournamentId, proposal.id, 'director-test');
    expect((await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).settings).toBe(beforeSettings);
    await expect(prisma.tournamentOperationAudit.findUnique({ where: { id: applied.auditId! } })).resolves.toMatchObject({ undoneBy: 'director-test' });
    await expect(applyScheduleOptimizationRecommendation(prisma, proposal.id, 'director-test')).rejects.toThrow('has been undone');
  });

  it('rejects foreign and resolved incidents from authoritative live conditions', async () => {
    await expect(saveScheduleOperationalConditions(prisma, tournamentId, {
      restWindowMinutes: 10, ringDelays: [], incidentBlocks: [{ incidentId: foreignIncidentId, ring: 1 }],
    })).rejects.toThrow('belong to this tournament');
    await expect(saveScheduleOperationalConditions(prisma, tournamentId, {
      restWindowMinutes: 10, ringDelays: [], incidentBlocks: [{ incidentId: resolvedIncidentId, ring: 1 }],
    })).rejects.toThrow('unresolved');
  });

  it('atomically supersedes proposed and approved recommendations when schedule inputs change', async () => {
    const proposed = await createScheduleOptimizationRecommendation(prisma, tournamentId, 'assistant-stale-proposed');
    await saveScheduleOperationalConditions(prisma, tournamentId, { restWindowMinutes: 12, ringDelays: [], incidentBlocks: [] });
    await expect(prisma.recommendation.findUniqueOrThrow({ where: { id: proposed.id } })).resolves.toMatchObject({
      status: 'rejected', rejectedBy: 'system:schedule-input-change', approvedBy: null, approvedAt: null,
    });

    const approved = await createScheduleOptimizationRecommendation(prisma, tournamentId, 'assistant-stale-approved');
    await approveRecommendation(prisma, approved.id, 'director-stale-approved', validateScheduleOptimizationRecommendation);
    const division = await prisma.division.findFirstOrThrow({ where: { tournamentId }, orderBy: { id: 'asc' } });
    await saveScheduleDivisionLock(prisma, tournamentId, division.id, true);
    await expect(prisma.recommendation.findUniqueOrThrow({ where: { id: approved.id } })).resolves.toMatchObject({
      status: 'rejected', rejectedBy: 'system:schedule-input-change', approvedBy: null, approvedAt: null,
    });
  });

  it('locks authoritative incidents and rejects an apply after concurrent resolution', async () => {
    await saveScheduleOperationalConditions(prisma, tournamentId, {
      restWindowMinutes: 10,
      ringDelays: [],
      incidentBlocks: [{ incidentId: activeIncidentId, ring: 2 }],
    });
    const proposal = await createScheduleOptimizationRecommendation(prisma, tournamentId, 'assistant-race');
    await approveRecommendation(prisma, proposal.id, 'director-race', validateScheduleOptimizationRecommendation);

    const writer = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    let releaseWriter!: () => void;
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    let writerLocked!: () => void;
    const locked = new Promise<void>((resolve) => { writerLocked = resolve; });
    const resolution = writer.$transaction(async (tx) => {
      await tx.incident.update({ where: { id: activeIncidentId }, data: { actionTaken: 'continued' } });
      writerLocked();
      await release;
    });
    await locked;

    const applying = applyScheduleOptimizationRecommendation(prisma, proposal.id, 'director-race');
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseWriter();
    await resolution;
    await expect(applying).rejects.toThrow(/validation|changed|incident|unresolved/i);
    await writer.$disconnect();
  });
});

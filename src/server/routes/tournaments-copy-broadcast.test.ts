import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import request from 'supertest';

vi.mock('../middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/auth.js')>()),
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { id: 'dir-1', role: 'director', email: 'director@example.test', firstName: 'D', lastName: 'Ir', isDemo: false };
    next();
  },
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn(), isEmailConfigured: vi.fn(() => true) }));
vi.mock('../services/email.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email.js')>()),
  sendEmail: email.sendEmail,
  isEmailConfigured: email.isEmailConfigured,
}));

import tournamentsRouter, { templateRulesToTournament } from './tournaments.js';
import { parseTournamentRules, DEFAULT_TOURNAMENT_RULES } from '../../shared/constants/tournament-rules.js';

const original = {
  id: 't-1',
  name: 'Spring Open',
  date: new Date('2026-05-10T12:00:00.000Z'),
  location: 'Gym',
  settings: JSON.stringify({ divisionThreshold: 8 }),
  sportProfileSlug: 'taekwondo',
  sportProfileId: null,
  organizationId: 'org-1',
  deletedAt: null,
};

const prisma = {
  tournament: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  userTournamentAccess: { findUnique: vi.fn() },
  organizationMember: { findUnique: vi.fn(), findMany: vi.fn() },
  organization: { findUnique: vi.fn() },
  registration: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  division: { findFirst: vi.fn() },
  weightClass: { findMany: vi.fn(), createMany: vi.fn() },
  tournamentRule: { findMany: vi.fn(), createMany: vi.fn() },
  tournamentTemplate: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
};

function makeApp() {
  const app = express();
  app.locals.prisma = prisma;
  app.use(express.json());
  app.use('/api/tournaments', tournamentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  email.isEmailConfigured.mockReturnValue(true);
  email.sendEmail.mockResolvedValue(undefined);
  prisma.tournament.findUnique.mockResolvedValue(original);
  prisma.tournament.count.mockResolvedValue(0);
  prisma.tournament.create.mockImplementation(async ({ data }) => ({ id: 't-new', ...data }));
  prisma.userTournamentAccess.findUnique.mockResolvedValue(null);
  prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });
  prisma.organizationMember.findMany.mockResolvedValue([{ organizationId: 'org-1', role: 'owner' }]);
  prisma.organization.findUnique.mockResolvedValue({ plan: 'enterprise' });
  prisma.registration.findMany.mockResolvedValue([]);
  prisma.weightClass.findMany.mockResolvedValue([]);
  prisma.tournamentRule.findMany.mockResolvedValue([]);
  prisma.auditLog.create.mockResolvedValue({});
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
});

describe('GET /:id/registrations?notInDivision (S1)', () => {
  it('hides registrations already in a division of the target event type and not entered in it', async () => {
    prisma.division.findFirst.mockResolvedValue({ eventType: 'sparring' });
    const res = await request(makeApp()).get('/api/tournaments/t-1/registrations?notInDivision=d-1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(prisma.division.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'd-1', tournamentId: 't-1' } }));
    const where = prisma.registration.findMany.mock.calls[0][0].where;
    expect(where.assignments).toEqual({ none: { division: { eventType: 'sparring' } } });
    expect(where.sparring).toBe(true);
    expect(where.waitlistStatus).toEqual({ in: ['active', 'promoted'] });
  });

  it('answers 404 for a division outside the tournament', async () => {
    prisma.division.findFirst.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/tournaments/t-1/registrations?notInDivision=elsewhere');
    expect(res.status).toBe(404);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });
});

describe('templateRulesToTournament (S3)', () => {
  it('merges an object TournamentRules into settings and creates no rule rows', () => {
    const rules = { ...DEFAULT_TOURNAMENT_RULES, divisions: { ...DEFAULT_TOURNAMENT_RULES.divisions, maxSize: 6 } };
    const out = templateRulesToTournament(JSON.stringify({ divisionThreshold: 5 }), JSON.stringify(rules));
    expect(out.legacyRuleRows).toEqual([]);
    const settings = JSON.parse(out.settings!);
    expect(settings.divisionThreshold).toBe(5);
    expect(parseTournamentRules(out.settings).divisions.maxSize).toBe(6);
  });

  it('keeps legacy array rules as rule rows and leaves settings alone', () => {
    const out = templateRulesToTournament('{"a":1}', JSON.stringify([{ name: 'Same school', category: 'bracket' }]));
    expect(out.settings).toBe('{"a":1}');
    expect(out.legacyRuleRows).toEqual([{ name: 'Same school', category: 'bracket' }]);
  });

  it('ignores missing or unparseable rules', () => {
    expect(templateRulesToTournament('{"a":1}', null)).toEqual({ settings: '{"a":1}', legacyRuleRows: [] });
    expect(templateRulesToTournament('{"a":1}', '{oops')).toEqual({ settings: '{"a":1}', legacyRuleRows: [] });
  });
});

describe('POST /from-template/:templateId (S3)', () => {
  it('stores template rules in the new tournament settings instead of a TournamentRule row', async () => {
    const rules = { ...DEFAULT_TOURNAMENT_RULES, divisions: { ...DEFAULT_TOURNAMENT_RULES.divisions, maxSize: 6 } };
    prisma.tournamentTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1', settings: JSON.stringify({ divisionThreshold: 5 }), rules: JSON.stringify(rules), weightClasses: null,
      sportProfileSlug: 'karate', brandName: null, brandPrimaryColor: null, brandLogoUrl: null,
    });
    const res = await request(makeApp()).post('/api/tournaments/from-template/tpl-1').send({ name: 'Cup', date: '2026-11-01' });
    expect(res.status).toBe(201);
    expect(prisma.tournamentRule.createMany).not.toHaveBeenCalled();
    const settings = prisma.tournament.create.mock.calls[0][0].data.settings;
    expect(JSON.parse(settings).divisionThreshold).toBe(5);
    expect(parseTournamentRules(settings).divisions.maxSize).toBe(6);
  });
});

describe('POST /:id/clone (S4)', () => {
  it('copies weight classes and rule rows inside the transaction', async () => {
    prisma.weightClass.findMany.mockResolvedValue([
      { id: 'wc-1', tournamentId: 't-1', name: 'Light', gender: 'M', ageMin: 10, ageMax: 11, weightMinLbs: 0, weightMaxLbs: 80, displayOrder: 0 },
    ]);
    prisma.tournamentRule.findMany.mockResolvedValue([
      { id: 'r-1', tournamentId: 't-1', name: 'Same school', description: null, category: 'bracket', ruleType: 'same_school_avoidance',
        enforcement: 'soft', parameters: '{}', priority: 60, isActive: true, source: 'manual', createdBy: 'u-1' },
    ]);
    const res = await request(makeApp()).post('/api/tournaments/t-1/clone').send({});
    expect(res.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.weightClass.createMany).toHaveBeenCalledWith({ data: [
      { tournamentId: 't-new', name: 'Light', gender: 'M', ageMin: 10, ageMax: 11, weightMinLbs: 0, weightMaxLbs: 80, displayOrder: 0 },
    ] });
    expect(prisma.tournamentRule.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({
      tournamentId: 't-new', name: 'Same school', ruleType: 'same_school_avoidance', priority: 60,
    })]);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it('with includeRegistrations copies only active/promoted entries and recomputes ages', async () => {
    prisma.registration.findMany.mockImplementation(async ({ where }) => {
      if (where.tournamentId === 't-1') return [{ competitorId: 'c-1', patterns: true, sparring: false, ageAtTournament: 9 }];
      // recomputeRegistrationAges reads the new tournament's rows.
      return [{
        id: 'reg-new', ageAtTournament: 9,
        competitor: { dateOfBirth: new Date('2016-01-01T12:00:00.000Z') },
        tournament: { date: new Date('2027-05-10T12:00:00.000Z') },
      }];
    });
    const res = await request(makeApp()).post('/api/tournaments/t-1/clone').send({ includeRegistrations: true });
    expect(res.status).toBe(201);
    expect(prisma.registration.findMany.mock.calls[0][0].where).toEqual({
      tournamentId: 't-1', waitlistStatus: { in: ['active', 'promoted'] },
    });
    expect(prisma.registration.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.registration.findMany.mock.calls[1][0].where).toEqual({ tournamentId: 't-new' });
    expect(prisma.registration.update).toHaveBeenCalledWith({ where: { id: 'reg-new' }, data: { ageAtTournament: 11 } });
  });
});

describe('POST /:id/broadcast (S5)', () => {
  const regs = [1, 2, 3].map((n) => ({
    id: `reg-${n}`, parentEmail: `p${n}@example.test`, parentName: `Parent ${n}`,
    competitor: { firstName: `Kid${n}`, lastName: 'Lee' },
  }));

  it('test mode sends exactly one preview to the director', async () => {
    prisma.registration.findMany.mockResolvedValue(regs.slice(0, 1));
    const res = await request(makeApp()).post('/api/tournaments/t-1/broadcast')
      .send({ subject: 'Hi {{competitor_first_name}}', body: 'See you', test: true });
    expect(res.status).toBe(200);
    expect(prisma.registration.findMany.mock.calls[0][0]).toMatchObject({ take: 1 });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).toHaveBeenCalledWith('director@example.test', 'Hi Kid1', expect.any(String));
    expect(res.body.sent).toBe(1);
  });

  it('real sends only go to active/promoted registrations with a parent email', async () => {
    prisma.registration.findMany.mockResolvedValue(regs);
    const res = await request(makeApp()).post('/api/tournaments/t-1/broadcast').send({ subject: 'Hi', body: 'See you' });
    expect(res.status).toBe(200);
    const query = prisma.registration.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      tournamentId: 't-1', waitlistStatus: { in: ['active', 'promoted'] }, parentEmail: { not: null },
    });
    expect(query.take).toBeUndefined();
    expect(email.sendEmail).toHaveBeenCalledTimes(3);
  });
});

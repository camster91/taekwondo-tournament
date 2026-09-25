/**
 * End-to-end tenant isolation against a real Postgres (Prisma `some` /
 * `every` / `none` relation filters only prove themselves on a DB).
 *
 * Opt-in: set TENANT_ISOLATION_DATABASE_URL to a disposable LOCAL
 * database with migrations applied. All rows are created with random
 * ids/slugs and removed in afterAll.
 *
 * Fixture:
 *   orgA ── TA (live), TAdel (soft-deleted)     orgB ── TB
 *   T0 (orphan, legacy single-tenant pool)
 *   dirA    director, orgA member (director)
 *   viewA   director globally, orgA member (viewer)
 *   legacy  director, no org
 *   cA, cA2 (near-duplicate of cA) → TA      cB, cB2 (dup of cB) → TB
 *   cShared → TA + TB     cLegacy → T0     cUnreg → no registrations
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

vi.mock('../index.js', async () => {
  const actual = await vi.importActual<typeof import('express')>('express');
  return { jsonBodyParser: (limit: string) => actual.json({ limit }) };
});

const databaseUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const run = randomUUID().slice(0, 8);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  TA: randomUUID(), TAdel: randomUUID(), TB: randomUUID(), T0: randomUUID(),
  dirA: randomUUID(), viewA: randomUUID(), legacy: randomUUID(),
  cA: randomUUID(), cA2: randomUUID(), cB: randomUUID(), cB2: randomUUID(),
  cShared: randomUUID(), cLegacy: randomUUID(), cUnreg: randomUUID(),
};
const dobA = new Date('2014-03-15T00:00:00.000Z');
const dobB = new Date('2013-07-02T00:00:00.000Z');

let prisma: PrismaClient;
let server: Server;
let baseUrl = '';
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

integration('tenant isolation (Postgres)', () => {
  beforeAll(async () => {
    if (!/^postgresql:\/\/[^/]+@(localhost|127\.0\.0\.1)(:\d+)?\//.test(databaseUrl!)) {
      throw new Error('TENANT_ISOLATION_DATABASE_URL must target a local database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });

    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: `[TEST] A ${run}`, slug: `tenant-a-${run}` },
        { id: ids.orgB, name: `[TEST] B ${run}`, slug: `tenant-b-${run}` },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: ids.dirA, email: `dir-a-${run}@test.local`, firstName: 'Dir', lastName: 'A', role: 'director' },
        { id: ids.viewA, email: `view-a-${run}@test.local`, firstName: 'View', lastName: 'A', role: 'director' },
        { id: ids.legacy, email: `legacy-${run}@test.local`, firstName: 'Leg', lastName: 'Acy', role: 'director' },
      ],
    });
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: ids.orgA, userId: ids.dirA, role: 'director' },
        { organizationId: ids.orgA, userId: ids.viewA, role: 'viewer' },
      ],
    });
    const date = new Date('2031-05-01T00:00:00.000Z');
    await prisma.tournament.createMany({
      data: [
        { id: ids.TA, organizationId: ids.orgA, name: `[TEST] TA ${run}`, date, location: 'x' },
        { id: ids.TAdel, organizationId: ids.orgA, name: `[TEST] TAdel ${run}`, date, location: 'x', deletedAt: new Date() },
        { id: ids.TB, organizationId: ids.orgB, name: `[TEST] TB ${run}`, date, location: 'x' },
        { id: ids.T0, organizationId: null, name: `[TEST] T0 ${run}`, date, location: 'x' },
      ],
    });
    const comp = (id: string, firstName: string, lastName: string, dateOfBirth: Date) => ({
      id, firstName, lastName, dateOfBirth, gender: 'M', belt: 'Blue', weightLbs: 80, specialNeeds: 'secret',
    });
    await prisma.competitor.createMany({
      data: [
        comp(ids.cA, 'Jonathan', `Alpha${run}`, dobA),
        comp(ids.cA2, 'Jonathon', `Alpha${run}`, dobA),
        comp(ids.cB, 'Brianna', `Bravo${run}`, dobB),
        comp(ids.cB2, 'Briana', `Bravo${run}`, dobB),
        comp(ids.cShared, 'Sam', `Shared${run}`, dobA),
        comp(ids.cLegacy, 'Lee', `Legacy${run}`, dobA),
        comp(ids.cUnreg, 'Una', `Unreg${run}`, dobA),
      ],
    });
    await prisma.registration.createMany({
      data: [
        { tournamentId: ids.TA, competitorId: ids.cA },
        { tournamentId: ids.TA, competitorId: ids.cA2 },
        { tournamentId: ids.TB, competitorId: ids.cB },
        { tournamentId: ids.TB, competitorId: ids.cB2 },
        { tournamentId: ids.TA, competitorId: ids.cShared },
        { tournamentId: ids.TB, competitorId: ids.cShared },
        { tournamentId: ids.T0, competitorId: ids.cLegacy },
      ],
    });

    const { createToken } = await import('./auth.js');
    const users = await prisma.user.findMany({ where: { id: { in: [ids.dirA, ids.viewA, ids.legacy] } } });
    for (const u of users) {
      const key = u.id === ids.dirA ? 'dirA' : u.id === ids.viewA ? 'viewA' : 'legacy';
      tokens[key] = createToken({ userId: u.id, email: u.email, role: u.role, tokenVersion: u.tokenVersion });
    }

    const { default: competitorsRouter } = await import('../routes/competitors.js');
    const { default: tournamentsRouter } = await import('../routes/tournaments.js');
    const app = express();
    app.use(express.json());
    app.locals.prisma = prisma;
    app.use('/api/competitors', competitorsRouter);
    app.use('/api/tournaments', tournamentsRouter);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.message ?? err) });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    if (!prisma) return;
    const allCompetitorsFilter = {
      OR: [
        { id: { in: Object.values(ids) } },
        { lastName: { endsWith: run } },
      ],
    };
    await prisma.registration.deleteMany({ where: { competitor: allCompetitorsFilter } });
    await prisma.competitor.deleteMany({ where: allCompetitorsFilter });
    await prisma.tournament.deleteMany({ where: { id: { in: [ids.TA, ids.TAdel, ids.TB, ids.T0] } } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.userAuditLog.deleteMany({ where: { userId: { in: [ids.dirA, ids.viewA, ids.legacy] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.dirA, ids.viewA, ids.legacy] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await prisma.$disconnect();
  });

  describe('tournament scoping', () => {
    it('org director lists only own org tournaments (no orphan, no other org, no trash by default)', async () => {
      const res = await call('GET', '/api/tournaments?trash=all', 'dirA');
      const mine = res.body.map((t: any) => t.id).filter((id: string) => Object.values(ids).includes(id));
      expect(mine.sort()).toEqual([ids.TA, ids.TAdel].sort());
    });

    it('legacy user lists orphan tournaments and never org-owned ones', async () => {
      const res = await call('GET', '/api/tournaments', 'legacy');
      const seen = res.body.map((t: any) => t.id);
      expect(seen).toContain(ids.T0);
      expect(seen).not.toContain(ids.TA);
      expect(seen).not.toContain(ids.TB);
    });

    it('org director cannot open an orphan tournament; legacy user cannot open an org tournament', async () => {
      expect((await call('GET', `/api/tournaments/${ids.T0}`, 'dirA')).status).toBe(403);
      expect((await call('GET', `/api/tournaments/${ids.TA}`, 'legacy')).status).toBe(403);
      expect((await call('GET', `/api/tournaments/${ids.T0}`, 'legacy')).status).toBe(200);
    });

    it('viewer-level org membership can read but not mutate, despite a global director role', async () => {
      expect((await call('GET', `/api/tournaments/${ids.TA}`, 'viewA')).status).toBe(200);
      expect((await call('PUT', `/api/tournaments/${ids.TA}`, 'viewA', { name: 'hijack' })).status).toBe(403);
    });

    it('soft-deleted tournament is 404 but its org director can restore it', async () => {
      expect((await call('GET', `/api/tournaments/${ids.TAdel}`, 'dirA')).status).toBe(404);
      expect((await call('POST', `/api/tournaments/${ids.TAdel}/restore`, 'dirB-missing')).status).toBe(401);
      expect((await call('POST', `/api/tournaments/${ids.TAdel}/restore`, 'legacy')).status).toBe(403);
      expect((await call('POST', `/api/tournaments/${ids.TAdel}/restore`, 'dirA')).status).toBe(204);
      expect((await call('GET', `/api/tournaments/${ids.TAdel}`, 'dirA')).status).toBe(200);
    });
  });

  describe('competitor scoping', () => {
    it('list: org director sees own-tenant competitors only; legacy sees legacy pool + unregistered', async () => {
      const a = await call('GET', `/api/competitors?search=${run}&limit=100`, 'dirA');
      expect(a.body.competitors.map((c: any) => c.id).sort()).toEqual([ids.cA, ids.cA2, ids.cShared].sort());
      const l = await call('GET', `/api/competitors?search=${run}&limit=100`, 'legacy');
      expect(l.body.competitors.map((c: any) => c.id).sort()).toEqual([ids.cLegacy, ids.cUnreg].sort());
    });

    it('history uses the same scope as GET /:id', async () => {
      expect((await call('GET', `/api/competitors/${ids.cB}/history`, 'dirA')).status).toBe(404);
      expect((await call('GET', `/api/competitors/${ids.cB}`, 'dirA')).status).toBe(404);
      expect((await call('GET', `/api/competitors/${ids.cA}/history`, 'dirA')).status).toBe(200);
    });

    it('a competitor shared with another tenant is NOT writable', async () => {
      expect((await call('PUT', `/api/competitors/${ids.cShared}`, 'dirA', { weightLbs: 999 })).status).toBe(404);
      expect((await prisma.competitor.findUnique({ where: { id: ids.cShared } }))!.weightLbs).toBe(80);
      expect((await call('PUT', `/api/competitors/${ids.cA}`, 'dirA', { weightLbs: 81 })).status).toBe(200);
    });

    it('duplicates are scoped, capped, clamped, and omit sensitive fields', async () => {
      const res = await call('GET', '/api/competitors/duplicates?threshold=0', 'dirA');
      expect(res.status).toBe(200);
      expect(res.body.threshold).toBe(0.5);
      const seen = new Set<string>();
      for (const d of res.body.duplicates) {
        seen.add(d.competitor1.id);
        seen.add(d.competitor2.id);
        expect(d.competitor1.specialNeeds).toBeUndefined();
      }
      expect(seen.has(ids.cB)).toBe(false);
      expect(seen.has(ids.cB2)).toBe(false);
      expect(seen.has(ids.cA) && seen.has(ids.cA2)).toBe(true);
      expect(res.body.duplicates.length).toBeLessThanOrEqual(200);
    });

    it('merge requires both competitors to be writable', async () => {
      const res = await call('POST', '/api/competitors/merge', 'dirA', { primaryId: ids.cA, secondaryId: ids.cB });
      expect(res.status).toBe(404);
      expect((await prisma.competitor.findUnique({ where: { id: ids.cB } }))!.deletedAt).toBeNull();
    });

    it('registering a foreign competitor into your own tournament is refused (single + bulk)', async () => {
      expect((await call('POST', `/api/tournaments/${ids.TA}/registrations`, 'dirA', { competitorId: ids.cB })).status).toBe(404);
      expect((await call('POST', `/api/tournaments/${ids.TA}/registrations/bulk`, 'dirA', { competitorIds: [ids.cB] })).status).toBe(404);
      expect(await prisma.registration.count({ where: { tournamentId: ids.TA, competitorId: ids.cB } })).toBe(0);
    });

    it('org director can create a competitor, see it, and register it (owning org)', async () => {
      const created = await call('POST', '/api/competitors', 'dirA', {
        firstName: 'Owned', lastName: `Owner${run}`, gender: 'F', dateOfBirth: '2012-05-05', belt: 'Green',
      });
      expect(created.status).toBe(201);
      expect(created.body.organizationId).toBe(ids.orgA);
      const listA = await call('GET', `/api/competitors?search=Owner${run}&limit=10`, 'dirA');
      expect(listA.body.competitors.map((c: any) => c.id)).toEqual([created.body.id]);
      // Invisible to the other tenant and to the legacy pool.
      expect((await call('GET', `/api/competitors/${created.body.id}`, 'legacy')).status).toBe(404);
      const reg = await call('POST', `/api/tournaments/${ids.TA}/registrations`, 'dirA', { competitorId: created.body.id, patterns: true });
      expect(reg.status).toBe(201);
    });

    it('org director cannot assign a new competitor to an org they are not in', async () => {
      const res = await call('POST', '/api/competitors', 'dirA', {
        firstName: 'Foreign', lastName: `Owner${run}`, gender: 'M', dateOfBirth: '2012-05-05', belt: 'Green', organizationId: ids.orgB,
      });
      expect(res.status).toBe(403);
    });

    it('legacy user can still register an unregistered legacy-pool competitor', async () => {
      const res = await call('POST', `/api/tournaments/${ids.T0}/registrations`, 'legacy', { competitorId: ids.cUnreg, patterns: true });
      expect(res.status).toBe(201);
    });

    it('Excel import never overwrites another tenant competitor matched by name + DOB', async () => {
      const res = await call('POST', '/api/competitors/import', 'dirA', {
        columnMapping: { firstName: 'First', lastName: 'Last', gender: 'Gender', belt: 'Belt', weight: 'Weight', dateOfBirth: 'DOB' },
        data: [{ First: 'Brianna', Last: `Bravo${run}`, Gender: 'F', Belt: 'Black', Weight: '150', DOB: dobB.toISOString() }],
      });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);
      expect(res.body.updated).toBe(0);
      const cB = await prisma.competitor.findUnique({ where: { id: ids.cB } });
      expect(cB!.belt).toBe('Blue');
      expect(cB!.weightLbs).toBe(80);
    });
  });
});

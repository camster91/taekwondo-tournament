import { describe, expect, it, vi } from 'vitest';
import { getBracketPlacementsFromLoaded } from './match-advancement.js';
import {
  DEMO_MARKER,
  DEMO_ORGANIZATION_SLUG,
  assertDemoResetAuthorized,
  assertSafeDemoDatabaseUrl,
  buildShowcaseFixture,
  resetDemoShowcase,
} from '../../../prisma/demo-seed.js';

describe('demo showcase fixture', () => {
  it('contains deterministic public open and live tournament experiences', () => {
    const now = new Date('2031-06-10T19:43:00.000Z');
    const fixture = buildShowcaseFixture(now);
    expect(fixture.organization.slug).toBe(DEMO_ORGANIZATION_SLUG);
    expect({
      tournaments: fixture.tournaments.length,
      competitors: fixture.competitors.length,
      registrations: fixture.registrations.length,
      divisions: fixture.divisions.length,
      brackets: fixture.brackets.length,
      matches: fixture.matches.length,
      placements: fixture.competitorHistories.length,
    }).toEqual({ tournaments: 2, competitors: 8, registrations: 16, divisions: 2, brackets: 2, matches: 14, placements: 1 });
    expect(JSON.parse(fixture.organization.settings)).toMatchObject({ marker: DEMO_MARKER });
    expect(fixture.tournaments.map((t) => [t.status, t.publicSlug])).toEqual([
      ['registration', 'bowin-demo-open-registration'],
      ['in_progress', 'bowin-demo-live-championship'],
    ]);
    expect(fixture.tournaments[1].date).toEqual(new Date('2031-06-10T09:00:00.000Z'));
    expect(fixture.tournaments[0].date).toEqual(new Date('2031-07-10T09:00:00.000Z'));
    expect(JSON.parse(fixture.tournaments[0].settings).registrationCloses).toBe('2031-07-03');
    expect(new Set(fixture.competitors.map((c) => c.schoolDojang)).size).toBeGreaterThanOrEqual(4);
    expect(fixture.competitors.some((c) => /[^\u0000-\u007f]/.test(`${c.firstName}${c.lastName}`))).toBe(true);
    expect(new Set(fixture.registrations.map((r) => r.checkedIn))).toEqual(new Set([true, false]));
    expect(new Set(fixture.divisions.map((d) => d.eventType))).toEqual(new Set(['patterns', 'sparring']));
    expect(new Set(fixture.matches.map((m) => m.status))).toEqual(
      new Set(['pending', 'ready', 'in_progress', 'completed']),
    );
    expect(new Set(fixture.matches.map((m) => m.ring).filter(Boolean))).toEqual(new Set(['1', '2', '3', '4']));
    expect(fixture.matches.filter((match) => match.scheduledAt !== null).every((match) => match.scheduledAt instanceof Date && !Number.isNaN(match.scheduledAt.getTime()))).toBe(true);
    fixture.matches.forEach((match, index) => {
      if (match.scheduledAt !== null) expect(match.scheduledAt.getTime()).toBe(Date.parse('2031-06-10T14:00:00.000Z') + index * 10 * 60_000);
    });
    expect(fixture.brackets.every((b) => JSON.parse(b.structure).positions)).toBe(true);
  });

  it('stores only internally valid match states and an honest mixed bracket progression', () => {
    const fixture = buildShowcaseFixture(new Date('2031-06-10T19:43:00.000Z'));
    for (const match of fixture.matches) {
      if (match.status === 'completed') {
        expect([match.competitor1Id, match.competitor2Id, match.winnerId, parseInt(match.scores ?? "0"), parseInt(match.scores ?? "0")]).not.toContain(null);
        expect([match.competitor1Id, match.competitor2Id]).toContain(match.winnerId);
      }
      if (match.status === 'in_progress' || match.status === 'ready') {
        expect(match.competitor1Id).not.toBeNull();
        expect(match.competitor2Id).not.toBeNull();
        expect(match.winnerId).toBeNull();
      }
    }
    const mixed = fixture.matches.filter((match) => match.bracketId === fixture.brackets[1].id);
    expect(mixed.map((match) => [match.matchNumber, match.status])).toEqual([
      [1, 'completed'], [2, 'completed'], [3, 'in_progress'], [4, 'ready'],
      [5, 'pending'], [6, 'pending'], [7, 'pending'],
    ]);
    expect(mixed.slice(0, 4).every((match) => match.competitor1Id && match.competitor2Id)).toBe(true);
    expect(mixed.slice(4).every((match) => match.competitor1Id === null && match.competitor2Id === null)).toBe(true);
    const reset = fixture.matches.find((match) => match.bracketId === fixture.brackets[0].id && match.matchNumber === 7)!;
    expect(reset).toMatchObject({ status: 'pending', competitor1Id: null, competitor2Id: null, ring: null, scheduledAt: null });
    expect(fixture.competitorHistories[0].matchesWon).toBe(3);
  });

  it('rejects destructive integration URLs outside an explicitly named local test database', () => {
    expect(() => assertSafeDemoDatabaseUrl('postgresql://user:secret@localhost:5432/bowin_test')).not.toThrow();
    expect(() => assertSafeDemoDatabaseUrl('postgresql://user:secret@127.0.0.1:5432/bowin_e2e')).not.toThrow();
    expect(() => assertSafeDemoDatabaseUrl('postgresql://user:secret@db.example.com/bowin_test')).toThrow(/local/i);
    expect(() => assertSafeDemoDatabaseUrl('postgresql://user:secret@localhost:5432/bowin')).toThrow(/_test.*_e2e/i);
    expect(() => assertSafeDemoDatabaseUrl('not-a-url')).toThrow(/valid/i);
  });

  it('requires explicit isolated-data and reset attestations for the CLI', () => {
    const authorized = {
      DATABASE_URL: 'postgresql://demo:secret@db.internal/bowin_showcase',
      DEMO_ISOLATED_DATA: '1',
      DEMO_RESET_CONFIRM: DEMO_MARKER,
    };
    expect(() => assertDemoResetAuthorized(authorized)).not.toThrow();
    expect(() => assertDemoResetAuthorized({ ...authorized, DEMO_ISOLATED_DATA: '' })).toThrow(/isolated/i);
    expect(() => assertDemoResetAuthorized({ ...authorized, DEMO_RESET_CONFIRM: '' })).toThrow(/attestation/i);
    expect(() => assertDemoResetAuthorized({ ...authorized, DATABASE_URL: '' })).toThrow(/DATABASE_URL/i);
  });

  it('completes a production four-person double-elimination bracket with derived podium places', () => {
    const fixture = buildShowcaseFixture();
    const bracket = fixture.brackets[0];
    const structure = JSON.parse(bracket.structure);
    const matches = fixture.matches.filter((match) => match.bracketId === bracket.id);

    expect(structure.positions).toEqual({ winnersFinal: 3, losersFinal: 5, grandFinals: 6, reset: 7 });
    expect(matches.filter((match) => [1, 2, 3, 4, 5, 6].includes(match.matchNumber)).every((match) => match.status === 'completed')).toBe(true);
    expect(matches.find((match) => match.matchNumber === structure.positions.reset)?.status).toBe('pending');
    expect(getBracketPlacementsFromLoaded(bracket.structure, matches as never)).toEqual([
      { place: 1, competitorId: fixture.registrations[0].id },
      { place: 2, competitorId: fixture.registrations[2].id },
      { place: 3, competitorId: fixture.registrations[4].id },
    ]);
  });
});

describe('resetDemoShowcase', () => {
  it('refuses to reset a canonical slug without the demo marker', async () => {
    const client = {
      organization: { findUnique: vi.fn().mockResolvedValue({ id: 'sentinel', settings: '{}' }) },
      $transaction: vi.fn(),
    };
    await expect(resetDemoShowcase(client as never)).rejects.toThrow(/refusing/i);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('deletes only captured orphan demo competitors and can run twice without accumulation', async () => {
    const calls: Array<{ model: string; operation: string; args: unknown }> = [];
    let organization: { id: string; settings: string } | null = {
      id: 'existing-demo', settings: JSON.stringify({ marker: DEMO_MARKER }),
    };
    const model = (name: string) => ({
      findMany: vi.fn(async () => name === 'registration' ? [{ competitorId: 'demo-c1' }, { competitorId: 'shared-c2' }] : []),
      findUnique: vi.fn(async () => name === 'organization' ? organization : null),
      deleteMany: vi.fn(async (args) => { calls.push({ model: name, operation: 'deleteMany', args }); return { count: 0 }; }),
      delete: vi.fn(async (args) => { calls.push({ model: name, operation: 'delete', args }); organization = null; return {}; }),
      create: vi.fn(async ({ data }) => { calls.push({ model: name, operation: 'create', args: { data } }); if (name === 'organization') organization = data; return data; }),
      createMany: vi.fn(async ({ data }) => { calls.push({ model: name, operation: 'createMany', args: { data } }); return { count: data.length }; }),
    });
    const client: Record<string, unknown> = { $transaction: async (fn: (tx: unknown) => unknown) => fn(client) };
    for (const name of ['organization', 'tournament', 'registration', 'competitor', 'division', 'divisionAssignment', 'bracket', 'match', 'competitorHistory']) client[name] = model(name);

    const first = await resetDemoShowcase(client as never);
    const second = await resetDemoShowcase(client as never);

    const competitorDeletes = calls.filter((c) => c.model === 'competitor' && c.operation === 'deleteMany');
    expect(competitorDeletes).toHaveLength(2);
    expect(competitorDeletes[0].args).toEqual({
      where: { id: { in: ['demo-c1', 'shared-c2'] }, registrations: { none: {} } },
    });
    const matchDeletes = calls.filter((c) => c.model === 'match' && c.operation === 'deleteMany');
    expect(matchDeletes).toHaveLength(2);
    expect(matchDeletes[0].args).toEqual({
      where: { bracket: { division: { tournament: { organizationId: 'existing-demo' } } } },
    });
    const tournamentDeletes = calls.filter((c) => c.model === 'tournament' && c.operation === 'deleteMany');
    expect(tournamentDeletes).toHaveLength(2);
    expect(tournamentDeletes[0].args).toEqual({ where: { organizationId: 'existing-demo' } });
    expect(calls.some((c) => !['competitor', 'match', 'tournament'].includes(c.model) && c.operation === 'deleteMany')).toBe(false);
    expect(calls.filter((c) => c.model === 'organization' && c.operation === 'delete')[0].args).toEqual({
      where: { id: 'existing-demo', settings: JSON.stringify({ marker: DEMO_MARKER }) },
    });
    expect(calls.filter((c) => c.model === 'organization' && c.operation === 'create')).toHaveLength(2);
    expect(second).toEqual(first);
  });
});







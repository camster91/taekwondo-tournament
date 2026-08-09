import { describe, expect, it, vi } from 'vitest';
import { getBracketPlacementsFromLoaded } from './match-advancement.js';
import {
  DEMO_MARKER,
  DEMO_ORGANIZATION_SLUG,
  buildShowcaseFixture,
  resetDemoShowcase,
} from '../../../prisma/demo-seed.js';

describe('demo showcase fixture', () => {
  it('contains deterministic public open and live tournament experiences', () => {
    const fixture = buildShowcaseFixture();
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
    expect(new Set(fixture.competitors.map((c) => c.schoolDojang)).size).toBeGreaterThanOrEqual(4);
    expect(fixture.competitors.some((c) => /[^\u0000-\u007f]/.test(`${c.firstName}${c.lastName}`))).toBe(true);
    expect(new Set(fixture.registrations.map((r) => r.checkedIn))).toEqual(new Set([true, false]));
    expect(new Set(fixture.divisions.map((d) => d.eventType))).toEqual(new Set(['patterns', 'sparring']));
    expect(new Set(fixture.matches.map((m) => m.status))).toEqual(
      new Set(['pending', 'ready', 'in_progress', 'completed']),
    );
    expect(new Set(fixture.matches.map((m) => m.ringNumber).filter(Boolean))).toEqual(new Set([1, 2, 3, 4]));
    expect(fixture.matches.every((match) => match.scheduledTime instanceof Date && !Number.isNaN(match.scheduledTime.getTime()))).toBe(true);
    expect(fixture.matches.map((match) => match.scheduledTime.getTime())).toEqual(
      fixture.matches.map((_, index) => Date.parse('2027-04-18T14:00:00.000Z') + index * 10 * 60_000),
    );
    expect(fixture.brackets.every((b) => JSON.parse(b.structure).positions)).toBe(true);
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
    const tournamentDeletes = calls.filter((c) => c.model === 'tournament' && c.operation === 'deleteMany');
    expect(tournamentDeletes).toHaveLength(2);
    expect(tournamentDeletes[0].args).toEqual({ where: { organizationId: 'existing-demo' } });
    expect(calls.some((c) => !['competitor', 'tournament'].includes(c.model) && c.operation === 'deleteMany')).toBe(false);
    expect(calls.filter((c) => c.model === 'organization' && c.operation === 'create')).toHaveLength(2);
    expect(second).toEqual(first);
  });
});

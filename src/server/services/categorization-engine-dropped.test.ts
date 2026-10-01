/**
 * Regression tests for registrations that auto-categorization used to
 * drop silently or mishandle:
 *  - black belts above 6th dan (K1)
 *  - registrations fitting no age band or with an unknown gender (K2)
 *  - a pinned registration excluded from BOTH events (K4)
 *  - smart merging ignoring the rules' minDivisionSize (K5)
 *  - the unreachable "merge with previous" branch (K7)
 */

import { describe, it, expect } from 'vitest';
import {
  autoCategorize,
  excludePinnedEvents,
  previewCategorization,
  smartMergeDivisions,
  type DivisionGroup,
  type RegistrationWithCompetitor,
} from './categorization-engine.js';

const reg = (
  id: string,
  overrides: Partial<RegistrationWithCompetitor> = {},
  competitor: Partial<RegistrationWithCompetitor['competitor']> = {},
): RegistrationWithCompetitor => ({
  id,
  competitorId: `c-${id}`,
  patterns: true,
  sparring: false,
  ageAtTournament: 20,
  weightAtRegistration: null,
  manualDivisionId: null,
  ...overrides,
  competitor: {
    firstName: id,
    lastName: 'Test',
    belt: 'Yellow',
    gender: 'M',
    schoolDojang: null,
    weightLbs: null,
    danRank: null,
    ...competitor,
  },
});

const allRegistrationIds = (result: ReturnType<typeof previewCategorization>) =>
  result.divisions.flatMap((division) => division.competitors.map((c) => c.registrationId)).sort();

describe('dan rank grouping (K1)', () => {
  it('keeps 7th-10th dan black belts in the top dan group', () => {
    const result = previewCategorization(
      [
        reg('d4', {}, { belt: 'Black', danRank: 4 }),
        reg('d7', {}, { belt: 'Black', danRank: 7 }),
        reg('d10', {}, { belt: 'Black', danRank: 10 }),
      ],
      { divisionThreshold: 8 },
    );

    expect(allRegistrationIds(result)).toEqual(['d10', 'd4', 'd7']);
    expect(result.divisions).toHaveLength(1);
    expect(result.divisions[0].name).toContain('BB 4th-10th Dan');
  });

  it('keeps the usual 4th-6th label when no higher dan is present', () => {
    const result = previewCategorization(
      [reg('d5', {}, { belt: 'Black', danRank: 5 })],
      { divisionThreshold: 8 },
    );
    expect(result.divisions[0].name).toContain('BB 4th-6th Dan');
  });

  it('warns about a dan rank that fits no group instead of dropping it silently', () => {
    const result = previewCategorization(
      [reg('neg', {}, { belt: 'Black', danRank: -1 })],
      { divisionThreshold: 8 },
    );
    expect(result.divisions).toHaveLength(0);
    expect(result.warnings).toContain(
      '1 black belt registration(s) have a dan rank outside every dan group and were not categorized.',
    );
  });
});

describe('uncategorizable registrations are reported (K2)', () => {
  it('warns about registrations that fit no age band, counted once across events', () => {
    const result = previewCategorization(
      [
        reg('old', { ageAtTournament: 120, sparring: true, weightAtRegistration: 150 }),
        reg('ok', { ageAtTournament: 20 }),
      ],
      { divisionThreshold: 8 },
    );
    expect(allRegistrationIds(result)).toEqual(['ok']);
    expect(result.warnings).toContain('1 registration(s) fit no age band and were not categorized.');
  });

  it('warns about registrations whose gender is not male or female', () => {
    const result = previewCategorization(
      [reg('x', {}, { gender: 'X' }), reg('f', {}, { gender: 'female' })],
      { divisionThreshold: 8 },
    );
    expect(allRegistrationIds(result)).toEqual(['f']);
    expect(result.warnings).toContain(
      '1 registration(s) were not categorized: gender is not male or female.',
    );
  });

  it('adds no such warnings when every registration is placed', () => {
    const result = previewCategorization([reg('ok')], { divisionThreshold: 8 });
    expect(result.warnings.some((w) => w.includes('not categorized'))).toBe(false);
  });
});

describe('pinned registrations keep their other event (K4)', () => {
  const both = reg(
    'both',
    { patterns: true, sparring: true, weightAtRegistration: 150, manualDivisionId: 'pinned-sparring' },
  );

  it('excludes only the event of the pinned division', () => {
    const { registrations, pinnedCount } = excludePinnedEvents([both], { 'pinned-sparring': 'sparring' });
    expect(pinnedCount).toBe(1);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ patterns: true, sparring: false });
  });

  it('drops a pinned registration with no other event, and an unknown pin entirely', () => {
    const onlySparring = { ...both, id: 'only', patterns: false };
    expect(excludePinnedEvents([onlySparring], { 'pinned-sparring': 'sparring' }).registrations).toEqual([]);
    expect(excludePinnedEvents([both], {}).registrations).toEqual([]);
  });

  it('skips an event the registration already holds in a kept division', () => {
    const { registrations } = excludePinnedEvents(
      [both, reg('member', { patterns: true, sparring: false })],
      { 'pinned-sparring': 'sparring' },
      { both: ['patterns'], member: ['patterns'] },
    );
    expect(registrations).toEqual([]);
  });

  it('a non-positive division threshold does not hang or crash the split', () => {
    const many = Array.from({ length: 12 }, (_, i) => reg(`r${i}`));
    for (const divisionThreshold of [0, -3]) {
      for (const enableSmartSplitting of [true, false]) {
        const result = previewCategorization(many, { divisionThreshold, enableSmartSplitting });
        expect(allRegistrationIds(result)).toHaveLength(12);
      }
    }
  });

  it('preview places the pinned registration in its other event only', () => {
    const result = previewCategorization([both], {
      divisionThreshold: 8,
      pinnedDivisionEventTypes: { 'pinned-sparring': 'sparring' },
    });
    expect(result.divisions).toHaveLength(1);
    expect(result.divisions[0].eventType).toBe('patterns');
    expect(allRegistrationIds(result)).toEqual(['both']);
  });

  it('auto-generate keeps the pinned division and creates only the other event', async () => {
    const deleteCalls: unknown[] = [];
    const created: Array<{ eventType: string }> = [];
    const assigned: string[] = [];
    const tx = {
      division: {
        deleteMany: async (args: unknown) => {
          deleteCalls.push(args);
          return { count: 0 };
        },
        create: async ({ data }: { data: { eventType: string } }) => {
          created.push(data);
          return { id: `generated-${created.length}` };
        },
      },
      divisionAssignment: {
        createMany: async ({ data }: { data: Array<{ registrationId: string }> }) => {
          assigned.push(...data.map((d) => d.registrationId));
          return { count: data.length };
        },
      },
    };
    const prisma = {
      division: {
        findMany: async () => [{ id: 'pinned-sparring', eventType: 'sparring' }],
      },
      divisionAssignment: {
        findMany: async () => [{ registrationId: 'both', division: { eventType: 'sparring' } }],
      },
      $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    };

    const result = await autoCategorize(prisma as never, 't1', [both], { divisionThreshold: 8 });

    expect(deleteCalls).toEqual([{ where: { tournamentId: 't1', id: { notIn: ['pinned-sparring'] } } }]);
    expect(created.map((d) => d.eventType)).toEqual(['patterns']);
    expect(assigned).toEqual(['both']);
    expect(result.assignments).toBe(1);
  });
});

describe('smartMergeDivisions (K5, K7)', () => {
  const group = (key: string, ageMin: number, ageMax: number, size: number): DivisionGroup => ({
    key,
    name: key,
    beltLevel: 'CB',
    gender: 'M',
    eventType: 'patterns',
    ageMin,
    ageMax,
    beltColors: ['Yellow'],
    registrations: Array.from({ length: size }, (_, i) => reg(`${key}-${i}`)),
  });

  it('merges a trailing small division into the previous eligible one', () => {
    const merged = smartMergeDivisions(
      [group('a', 6, 7, 4), group('b', 8, 9, 1)],
      { divisionThreshold: 8, enableSmartMerging: true },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].registrations).toHaveLength(5);
    expect(merged[0]).toMatchObject({ ageMin: 6, ageMax: 9 });
  });

  it('merges a trailing division into a previous merge result', () => {
    const merged = smartMergeDivisions(
      [group('a', 6, 7, 1), group('b', 8, 9, 1), group('c', 10, 11, 1)],
      { divisionThreshold: 8, enableSmartMerging: true },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].registrations).toHaveLength(3);
  });

  it('does not merge into the previous division beyond the split threshold', () => {
    const merged = smartMergeDivisions(
      [group('a', 6, 7, 8), group('b', 8, 9, 1)],
      { divisionThreshold: 8, enableSmartMerging: true },
    );
    expect(merged.map((g) => g.registrations.length)).toEqual([8, 1]);
  });

  it('uses the configured minDivisionSize instead of the hard-coded default', () => {
    const groups = [group('a', 6, 7, 2), group('b', 8, 9, 2)];
    // Default minimum (3): two 2-person divisions merge.
    expect(smartMergeDivisions(groups, { divisionThreshold: 8, enableSmartMerging: true })).toHaveLength(1);
    // Rules minimum of 2: both are already big enough.
    expect(
      smartMergeDivisions(groups, { divisionThreshold: 8, enableSmartMerging: true, minDivisionSize: 2 }),
    ).toHaveLength(2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildClassicLosersSide,
  buildClassicRounds,
  classicBracketLayout,
  classicLosersLayout,
  classicPageColumns,
  classicSheetCapacity,
  classicSlotDetail,
  classicTreePages,
  CLASSIC_MIN_SLOT_HEIGHT,
  generateClassicBracketPDF,
  type ClassicMatchInput,
  type ClassicSlot,
} from './pdf-export.js';
import { tournamentDefaultBracketFormat } from './bracket-formats.js';
import { generateBracket, type BracketStructure, type CompetitorSeed } from './bracket-generator.js';
import { createZip, crc32 } from '../utils/zip.js';
import { inflateRawSync } from 'zlib';

const slot = (n: number, danRank: number | null = null): ClassicSlot => ({ id: `r${n}`, name: `Player ${n}`, school: `School ${n}`, danRank });

describe('classicSheetCapacity', () => {
  it.each([
    [0, 2], [1, 2], [2, 2], [3, 4], [4, 4], [5, 8], [8, 8], [9, 16], [16, 16], [17, 32],
  ])('%i entrants use the %i sheet', (entrants, size) => {
    expect(classicSheetCapacity(entrants)).toBe(size);
  });
});

describe('classicBracketLayout', () => {
  it('draws the 16 sheet as 16 → 8 → 4 → 2 → winner on legal landscape', () => {
    const layout = classicBracketLayout(16);
    expect(layout.page).toEqual({ width: 1008, height: 612 });
    expect(layout.columns.map((c) => c.slotYs.length)).toEqual([16, 8, 4, 2, 1]);
    expect(layout.placementBoxes.map((b) => b.label)).toEqual(['1st', '2nd', '3rd', '3rd']);
  });

  it.each([2, 4, 8, 16, 32])('puts every later slot halfway between its two feeders (%i sheet)', (size) => {
    const { columns } = classicBracketLayout(size);
    for (let c = 1; c < columns.length; c++) {
      columns[c].slotYs.forEach((y, j) => {
        const feeders = columns[c - 1].slotYs;
        expect(y).toBeCloseTo((feeders[2 * j] + feeders[2 * j + 1]) / 2, 6);
      });
    }
  });

  it('keeps columns side by side, left of the placement boxes, inside the page', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const layout = classicBracketLayout(size);
      layout.columns.forEach((col, c) => {
        if (c > 0) expect(col.x).toBeCloseTo(layout.columns[c - 1].x + layout.columns[c - 1].width, 6);
        for (const y of col.slotYs) {
          expect(y).toBeGreaterThan(layout.bracketTop);
          expect(y).toBeLessThan(layout.bracketBottom);
        }
      });
      const last = layout.columns[layout.columns.length - 1];
      expect(last.x + last.width).toBeLessThanOrEqual(layout.placementBoxes[0].x);
      for (const box of layout.placementBoxes) {
        expect(box.x + box.width).toBeLessThanOrEqual(layout.page.width);
        expect(box.y + box.height).toBeLessThan(layout.bracketBottom);
      }
    }
  });

  it('has only 1st and 2nd for a two-person sheet', () => {
    expect(classicBracketLayout(2).placementBoxes.map((b) => b.label)).toEqual(['1st', '2nd']);
  });
});

describe('buildClassicRounds', () => {
  it('lays out a draft in standard seed order when no bracket exists (byes face top seeds)', () => {
    const rounds = buildClassicRounds(null, [slot(1), slot(2), slot(3), slot(4), slot(5)]);
    expect(rounds.draft).toBe(true);
    expect(rounds.columns.map((c) => c.length)).toEqual([8, 4, 2, 1]);
    // 1 v 8(bye), 4 v 5, 2 v 7(bye), 3 v 6(bye)
    expect(rounds.columns[0].map((s) => s?.id ?? null)).toEqual(['r1', null, 'r4', 'r5', 'r2', null, 'r3', null]);
  });

  const m = (round: number, n: number, c1: ClassicSlot | null, c2: ClassicSlot | null, winner: ClassicSlot | null, type = 'winners'): ClassicMatchInput => ({
    bracketType: type, roundNumber: round, matchNumber: n, competitor1: c1, competitor2: c2, winner,
  });

  it('fills winners, champion and 1st/2nd/3rd for single elimination', () => {
    const [a, b, c, d] = [slot(1), slot(2), slot(3), slot(4)];
    const rounds = buildClassicRounds({
      format: 'single_elim',
      matches: [
        m(1, 2, c, d, d), // out of order on purpose
        m(1, 1, a, b, a),
        m(2, 3, a, d, a, 'finals'),
      ],
    }, []);
    expect(rounds.draft).toBe(false);
    expect(rounds.columns[0].map((s) => s?.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(rounds.columns[1].map((s) => s?.id)).toEqual(['r1', 'r4']);
    expect(rounds.columns[2].map((s) => s?.id)).toEqual(['r1']);
    expect(rounds.placements.first?.id).toBe('r1');
    expect(rounds.placements.second?.id).toBe('r4');
    expect(rounds.placements.thirds.map((s) => s.id)).toEqual(['r2', 'r3']);
  });

  it('uses the final as round one for a two-person bracket', () => {
    const rounds = buildClassicRounds({ format: 'single_elim', matches: [m(1, 1, slot(1), slot(2), null, 'finals')] }, []);
    expect(rounds.columns.map((c) => c.length)).toEqual([2, 1]);
    expect(rounds.columns[0].map((s) => s?.id)).toEqual(['r1', 'r2']);
    expect(rounds.columns[1]).toEqual([null]);
  });

  it('only prints the starting names for double elimination', () => {
    const [a, b, c, d] = [slot(1), slot(2), slot(3), slot(4)];
    const rounds = buildClassicRounds({
      format: 'double_elim',
      matches: [m(1, 1, a, b, a), m(1, 2, c, d, d), m(2, 3, a, d, a), m(1, 4, b, c, b, 'losers')],
    }, []);
    expect(rounds.columns[0].map((s) => s?.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(rounds.columns[1]).toEqual([null, null]);
    expect(rounds.placements.first).toBeNull();
  });
});

describe('classicSlotDetail', () => {
  it('shows school and dan', () => {
    expect(classicSlotDetail(slot(1, 2))).toBe('School 1 - 2nd Dan');
    expect(classicSlotDetail({ id: 'x', name: 'X' })).toBe('');
  });
});

describe('generateClassicBracketPDF', () => {
  it('produces a legal landscape PDF', () => {
    const doc = generateClassicBracketPDF(
      { name: 'Open', date: '2027-05-01' },
      { title: 'SPARRING Females 10 - 11 Heavy', divisionName: 'Div', beltRange: 'Colour belts: Blue', rounds: buildClassicRounds(null, [slot(1), slot(2), slot(3)]) },
    );
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(1008, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(612, 0);
    expect(Buffer.from(doc.output('arraybuffer')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('classicTreePages', () => {
  it.each([2, 4, 8, 16, 32])('keeps the %i sheet on one page with room for 8pt names', (size) => {
    const pages = classicTreePages(size);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ capacity: size, pageNumber: null, hasFinal: true });
    const { columns, bracketTop, bracketBottom } = classicBracketLayout(size);
    expect((bracketBottom - bracketTop) / columns[0].slotYs.length).toBeGreaterThanOrEqual(CLASSIC_MIN_SLOT_HEIGHT);
  });

  it('splits a 64 sheet into top and bottom halves plus a final page', () => {
    const pages = classicTreePages(64);
    expect(pages.map((p) => [p.capacity, p.columnOffset, p.part, p.pageNumber, p.totalPages, p.hasFinal])).toEqual([
      [32, 0, 0, 1, 3, false],
      [32, 0, 1, 2, 3, false],
      [2, 5, 0, 3, 3, true],
    ]);
    for (const page of pages) {
      const { columns, bracketTop, bracketBottom } = classicBracketLayout(page.capacity);
      expect((bracketBottom - bracketTop) / columns[0].slotYs.length).toBeGreaterThanOrEqual(CLASSIC_MIN_SLOT_HEIGHT);
    }
  });

  it('gives each page its own block of the tree', () => {
    const tree = [64, 32, 16, 8, 4, 2, 1].map((n, c) => Array.from({ length: n }, (_, j) => `${c}:${j}`));
    const [top, bottom, final] = classicTreePages(64).map((page) => classicPageColumns(tree, page));
    expect(top.map((c) => c.length)).toEqual([32, 16, 8, 4, 2, 1]);
    expect(top[0][0]).toBe('0:0');
    expect(top[5]).toEqual(['5:0']);
    expect(bottom[0][0]).toBe('0:32');
    expect(bottom[5]).toEqual(['5:1']);
    expect(final).toEqual([['5:0', '5:1'], ['6:0']]);
  });

  it('keeps 3rd place boxes on the final page of a split sheet', () => {
    expect(classicBracketLayout(2, 64).placementBoxes.map((b) => b.label)).toEqual(['1st', '2nd', '3rd', '3rd']);
  });
});

describe('losers side (double elimination)', () => {
  const seeds = (n: number): CompetitorSeed[] =>
    Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, name: `Player ${i + 1}`, school: `School ${i + 1}` }));
  const inputs = (structure: BracketStructure, known: Record<number, Partial<ClassicMatchInput>> = {}): ClassicMatchInput[] =>
    [
      ...structure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
      ...structure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
      ...structure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
    ].map((m) => ({
      bracketType: m.bracketType, roundNumber: m.round, matchNumber: m.matchNumber,
      competitor1: null, competitor2: null, winner: null, ...known[m.matchNumber],
    }));

  it('labels every losers match with where its people come from, plus the grand final and reset', () => {
    const structure = generateBracket(seeds(8), 'random');
    const side = buildClassicLosersSide(structure, inputs(structure))!;
    expect(side.rounds.map((r) => r.label)).toEqual(['Losers round 1', 'Losers round 2', 'Losers round 3', "Losers' final"]);
    expect(side.rounds.flatMap((r) => r.matches.map((m) => m.matchNumber))).toEqual(structure.losers.map((m) => m.matchNumber).sort((a, b) => a - b));
    const first = side.rounds[0].matches[0];
    expect(first.slots.map((s) => s.feeder)).toEqual(['Loser of M1', 'Loser of M2']);
    // Drop-down match: losers' survivor first, then the loser dropping from the winners' side.
    expect(side.rounds[1].matches[0].slots.map((s) => s.feeder)).toEqual(['Winner of M8', 'Loser of M6']);

    const [grand, reset] = side.finals;
    expect(grand).toMatchObject({ matchNumber: structure.positions.grandFinals, title: 'Grand final' });
    expect(grand.slots.map((s) => s.feeder)).toEqual([`Winner of M${structure.positions.winnersFinal}`, `Winner of M${structure.positions.losersFinal}`]);
    expect(reset.matchNumber).toBe(structure.positions.reset);
    expect(reset.note).toBe(`Only if the winner of M${structure.positions.losersFinal} wins M${structure.positions.grandFinals}`);
  });

  it('fills in names and winners already known', () => {
    const structure = generateBracket(seeds(4), 'random');
    const [a, b] = [slot(1), slot(2)];
    const losersOne = structure.losers[0].matchNumber;
    const side = buildClassicLosersSide(structure, inputs(structure, { [losersOne]: { competitor1: a, competitor2: b, winner: b } }))!;
    const match = side.rounds[0].matches[0];
    expect(match.slots.map((s) => s.competitor?.id)).toEqual(['r1', 'r2']);
    expect(match.winner?.id).toBe('r2');
  });

  it('has no losers side for 2 people or single elimination', () => {
    expect(buildClassicLosersSide(generateBracket(seeds(2), 'random'), [])).toBeNull();
    expect(buildClassicLosersSide(null, [])).toBeNull();
    expect(buildClassicLosersSide({ winners: [], losers: [], finals: [], competitorCount: 0, positions: { winnersFinal: null, losersFinal: null, grandFinals: null, reset: null } }, [])).toBeNull();
  });

  it.each([4, 8, 16, 32, 64])('lays out the %i bracket on one page without overlapping boxes', (n) => {
    const structure = generateBracket(seeds(n), 'random');
    const layout = classicLosersLayout(buildClassicLosersSide(structure, [])!);
    expect(layout.columns).toHaveLength(new Set(structure.losers.map((m) => m.round)).size + 1);
    expect(layout.columns.flatMap((c) => c.boxes)).toHaveLength(structure.losers.length + structure.finals.length);
    layout.columns.forEach((col, c) => {
      if (c > 0) expect(col.x).toBeGreaterThan(layout.columns[c - 1].x + layout.columns[c - 1].width);
      expect(col.x + col.width).toBeLessThanOrEqual(layout.page.width);
      col.boxes.forEach((box, j) => {
        expect(box.height).toBeGreaterThanOrEqual(20);
        expect(box.y).toBeGreaterThanOrEqual(layout.top);
        expect(box.y + box.height).toBeLessThanOrEqual(layout.bottom);
        if (j > 0) expect(box.y).toBeGreaterThan(col.boxes[j - 1].y + col.boxes[j - 1].height);
      });
    });
  });
});

describe('generateClassicBracketPDF pages', () => {
  const info = { name: 'Open', date: '2027-05-01' };
  const sheet = (rounds: ReturnType<typeof buildClassicRounds>) => ({ title: 'SPARRING Males 12 - 14', divisionName: 'Div', beltRange: 'Black belts', rounds });

  it('adds the losers side as a second page for double elimination', () => {
    const structure = generateBracket(Array.from({ length: 8 }, (_, i) => ({ registrationId: `r${i + 1}`, name: `P${i}`, school: 'S' })), 'random');
    const doc = generateClassicBracketPDF(info, {
      ...sheet(buildClassicRounds(null, Array.from({ length: 8 }, (_, i) => slot(i + 1)))),
      losers: buildClassicLosersSide(structure, []),
    });
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('prints a 32 sheet on one page and a 64 sheet on three', () => {
    const entrants = (n: number) => Array.from({ length: n }, (_, i) => ({ ...slot(i + 1), name: `Alexandra Montgomery-Fitzgerald ${i}` }));
    expect(generateClassicBracketPDF(info, sheet(buildClassicRounds(null, entrants(32)))).getNumberOfPages()).toBe(1);
    expect(generateClassicBracketPDF(info, sheet(buildClassicRounds(null, entrants(40)))).getNumberOfPages()).toBe(3);
  });
});

describe('tournamentDefaultBracketFormat', () => {
  it.each([
    [null, 'double_elim'],
    ['', 'double_elim'],
    ['not json', 'double_elim'],
    ['null', 'double_elim'],
    ['{}', 'double_elim'],
    ['{"defaultBracketFormat":"single_elim"}', 'single_elim'],
    ['{"defaultBracketFormat":"round_robin"}', 'double_elim'],
  ])('%s → %s', (settings, expected) => {
    expect(tournamentDefaultBracketFormat(settings)).toBe(expected);
  });
});

describe('createZip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('writes entries that read back, with folders and UTF-8 names', () => {
    const zip = createZip([
      { path: 'CB Females Sparring/a.pdf', data: Buffer.from('a'.repeat(500)) },
      { path: 'BB Males Patterns/Ünïcode.pdf', data: Buffer.from('x') },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // End of central directory: 2 entries.
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);

    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString('utf8')).toBe('CB Females Sparring/a.pdf');
    expect(zip.readUInt16LE(8)).toBe(8); // deflated
    const size = zip.readUInt32LE(18);
    expect(inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + size)).toString()).toBe('a'.repeat(500));
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildClassicRounds,
  classicBracketLayout,
  classicSheetCapacity,
  classicSlotDetail,
  generateClassicBracketPDF,
  type ClassicMatchInput,
  type ClassicSlot,
} from './pdf-export.js';
import { tournamentDefaultBracketFormat } from './bracket-formats.js';
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

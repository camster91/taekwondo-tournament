/**
 * The bracket PDF's winners side used to lay out only rounds 1-3 with a
 * fixed height/4 spacing: a 16-person bracket's 8 first-round matches ran
 * off the page and its winners final (round 4) was never drawn. These
 * tests render real generated brackets and read the uncompressed PDF
 * content stream to check every winners match is drawn on the page.
 */
import { describe, expect, it } from 'vitest';
import { generateBracket, type CompetitorSeed, type MatchData } from './bracket-generator.js';
import { generateBracketPDF, type BracketMatch } from './pdf-export.js';

const PAGE_W = 792; // letter, landscape, in pt
const PAGE_H = 612;

function seeds(n: number): CompetitorSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `r${i + 1}`,
    competitorId: `c${i + 1}`,
    name: `Competitor Number ${i + 1}`,
    school: `School ${i % 5}`,
    seedPosition: i + 1,
  }));
}

function toPdfMatches(list: MatchData[], bracketType: BracketMatch['bracketType']): BracketMatch[] {
  return list.map(m => ({
    matchNumber: m.matchNumber,
    round: m.round,
    bracketType,
    status: 'pending',
    competitor1: m.competitor1Id ? { id: m.competitor1Id, name: `Name ${m.competitor1Id}`, school: 'S' } : null,
    competitor2: m.competitor2Id ? { id: m.competitor2Id, name: `Name ${m.competitor2Id}`, school: 'S' } : null,
  }));
}

type Op = { kind: 'text'; text: string; x: number; y: number } | { kind: 'rect'; x: number; y: number; w: number; h: number };

/** Text and rectangle operations from jsPDF's uncompressed output (PDF y-axis points up). */
function drawOps(pdf: string): Op[] {
  const ops: Op[] = [];
  let last: { x: number; y: number } | null = null;
  for (const line of pdf.split('\n')) {
    const td = line.match(/^(-?[\d.]+) (-?[\d.]+) Td$/);
    if (td) last = { x: Number(td[1]), y: Number(td[2]) };
    const tj = line.match(/^\((.*)\) Tj$/);
    if (tj && last) ops.push({ kind: 'text', text: tj[1], ...last });
    const re = line.match(/^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/);
    if (re) ops.push({ kind: 'rect', x: Number(re[1]), y: Number(re[2]), w: Number(re[3]), h: Number(re[4]) });
  }
  return ops;
}

function render(n: number) {
  const structure = generateBracket(seeds(n), 'random');
  const matches = [
    ...toPdfMatches(structure.winners, 'winners'),
    ...toPdfMatches(structure.losers, 'losers'),
    ...toPdfMatches(structure.finals, 'finals'),
  ];
  const doc = generateBracketPDF({
    tournament: { name: 'Spring Open', date: '2026-04-18' },
    division: { name: 'Adult BB Sparring', beltLevel: 'BB', gender: 'M', eventType: 'sparring', ageMin: 18, ageMax: 35 },
    matches,
    positions: structure.positions,
  });
  return { structure, ops: drawOps(doc.output()), pages: doc.getNumberOfPages() };
}

describe('bracket PDF winners layout', () => {
  for (const n of [8, 16, 32]) {
    it(`draws every winners match of a ${n}-competitor DE bracket inside the page`, () => {
      const { structure, ops, pages } = render(n);
      expect(pages).toBe(1);

      const maxRound = Math.max(...structure.winners.map(m => m.round));
      expect(structure.winners.some(m => m.round === maxRound)).toBe(true);

      const labels = ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
      for (const match of structure.winners) {
        const drawn = labels.filter(op => op.text === `Match #${match.matchNumber}`);
        expect(drawn, `winners match ${match.matchNumber} (round ${match.round})`).toHaveLength(1);
        // Above the bottom margin and below the top edge; left of the losers column.
        expect(drawn[0].x).toBeGreaterThanOrEqual(0);
        expect(drawn[0].x).toBeLessThan(400);
        expect(drawn[0].y).toBeGreaterThanOrEqual(30);
        expect(drawn[0].y).toBeLessThanOrEqual(PAGE_H);
      }

      for (const op of ops) {
        if (op.kind !== 'rect') continue;
        const top = Math.max(op.y, op.y + op.h);
        const bottom = Math.min(op.y, op.y + op.h);
        expect(op.x).toBeGreaterThanOrEqual(0);
        expect(op.x + op.w).toBeLessThanOrEqual(PAGE_W);
        expect(bottom).toBeGreaterThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(PAGE_H);
      }
    });
  }

  it('gives the 16-competitor winners final its own column to the right of round 3', () => {
    const { structure, ops } = render(16);
    const xOf = (matchNumber: number) =>
      ops.find(op => op.kind === 'text' && op.text === `Match #${matchNumber}`)!.x;
    const final = structure.winners.find(m => m.matchNumber === structure.positions.winnersFinal)!;
    expect(final.round).toBe(4);
    for (const m of structure.winners.filter(w => w.round === 3)) {
      expect(xOf(final.matchNumber)).toBeGreaterThan(xOf(m.matchNumber));
    }
  });
});

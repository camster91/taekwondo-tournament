import { describe, it, expect } from 'vitest';
import { generateBracket, generateSingleElimination, type BracketStructure, type CompetitorSeed } from './bracket-generator.js';
import { generateRoundRobin } from './bracket-formats.js';
import { computeBracketSync } from './match-advancement.js';
import { planSlotEdit, type SlotEditMatch, type SlotUpdate, type SlotEdit } from './bracket-slots.js';
import { entryMatchNumbers, isSlotEditableMatch } from '../../shared/utils/bracket-slots.js';
import { AppError } from '../utils/errors.js';

const seeds = (n: number): CompetitorSeed[] =>
  Array.from({ length: n }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    name: `Competitor ${i + 1}`,
    school: `School ${i + 1}`,
    seedPosition: i + 1,
  }));

function applyUpdates(rows: SlotEditMatch[], updates: SlotUpdate[] | ReturnType<typeof computeBracketSync>): SlotEditMatch[] {
  const next = rows.map((r) => ({ ...r }));
  for (const u of updates) Object.assign(next.find((r) => r.id === u.id)!, u.data);
  return next;
}

/** Rows as the generate route creates them, with byes resolved. */
function rowsFor(structure: BracketStructure): SlotEditMatch[] {
  const rows: SlotEditMatch[] = [
    ...structure.winners.map((m) => ({ ...m, bracketType: 'winners' })),
    ...structure.losers.map((m) => ({ ...m, bracketType: 'losers' })),
    ...structure.finals.map((m) => ({ ...m, bracketType: 'finals' })),
  ].map((m) => ({
    id: `m${m.matchNumber}`,
    matchNumber: m.matchNumber,
    bracketType: m.bracketType,
    competitor1Id: m.competitor1Id || null,
    competitor2Id: m.competitor2Id || null,
    winnerId: null,
    status: m.competitor1Id && m.competitor2Id ? 'ready' : 'pending',
    notes: null,
    score1: null,
    score2: null,
  }));
  return applyUpdates(rows, computeBracketSync(structure, rows));
}

/** Record a real result and let the engine advance it. */
function play(structure: BracketStructure, rows: SlotEditMatch[], matchNumber: number, winnerSlot: 1 | 2): SlotEditMatch[] {
  const next = rows.map((r) => ({ ...r }));
  const m = next.find((r) => r.matchNumber === matchNumber)!;
  m.status = 'completed';
  m.winnerId = winnerSlot === 1 ? m.competitor1Id : m.competitor2Id;
  return applyUpdates(next, computeBracketSync(structure, next));
}

const at = (rows: SlotEditMatch[], n: number) => rows.find((r) => r.matchNumber === n)!;
const entryRows = (structure: BracketStructure, rows: SlotEditMatch[]) => {
  const entries = entryMatchNumbers(structure);
  return rows.filter((r) => entries.has(r.matchNumber)).sort((a, b) => a.matchNumber - b.matchNumber);
};
const division = (n: number) => new Set(Array.from({ length: n + 2 }, (_, i) => `reg-${i + 1}`));

function expectAppError(fn: () => unknown, status: number, pattern: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(status);
    expect((error as AppError).message).toMatch(pattern);
    return;
  }
  throw new Error('expected an error');
}

/** Run an edit and return the rows after it is applied. */
function edit(structure: BracketStructure, rows: SlotEditMatch[], change: SlotEdit, members = division(16)) {
  const plan = planSlotEdit(structure, rows, change, members);
  return { plan, rows: applyUpdates(rows, plan.updates) };
}

describe('entryMatchNumbers', () => {
  it('is the winners first round of a double-elimination bracket', () => {
    const s = generateBracket(seeds(8));
    expect([...entryMatchNumbers(s)].sort((a, b) => a - b)).toEqual(
      s.winners.filter((m) => m.round === 1).map((m) => m.matchNumber).sort((a, b) => a - b),
    );
  });

  it('never includes the losers bracket, later rounds or the reset match', () => {
    const s = generateBracket(seeds(2));
    expect([...entryMatchNumbers(s)]).toEqual([1]);
    const big = generateBracket(seeds(16));
    for (const m of big.losers) expect(entryMatchNumbers(big).has(m.matchNumber)).toBe(false);
    expect(entryMatchNumbers(big).size).toBe(8);
  });

  it('is the lone final of a 2-person single elimination bracket', () => {
    const s = generateSingleElimination(seeds(2));
    expect([...entryMatchNumbers(s)]).toEqual([s.finals[0].matchNumber]);
  });

  it('is empty for round robin', () => {
    expect(entryMatchNumbers(generateRoundRobin(seeds(4))).size).toBe(0);
    expect(entryMatchNumbers(null).size).toBe(0);
  });
});

describe('isSlotEditableMatch', () => {
  const base = { competitor1Id: 'a', competitor2Id: null, notes: null };
  it('allows unplayed and automatic-BYE matches only', () => {
    expect(isSlotEditableMatch({ ...base, status: 'pending' })).toBe(true);
    expect(isSlotEditableMatch({ ...base, competitor2Id: 'b', status: 'ready' })).toBe(true);
    expect(isSlotEditableMatch({ ...base, status: 'completed', notes: 'BYE' })).toBe(true);
    expect(isSlotEditableMatch({ ...base, competitor2Id: 'b', status: 'in_progress' })).toBe(false);
    expect(isSlotEditableMatch({ ...base, competitor2Id: 'b', status: 'completed' })).toBe(false);
  });
});

describe('planSlotEdit', () => {
  it('swaps two people in different first-round matches', () => {
    const s = generateBracket(seeds(8));
    const rows = rowsFor(s);
    const [a, b] = entryRows(s, rows);
    const personA = a.competitor1Id!;
    const personB = b.competitor2Id!;
    const { plan, rows: after } = edit(s, rows, {
      action: 'move', registrationId: personA,
      from: { matchId: a.id, slot: 1 }, to: { matchId: b.id, slot: 2 },
    });
    expect(at(after, a.matchNumber).competitor1Id).toBe(personB);
    expect(at(after, b.matchNumber).competitor2Id).toBe(personA);
    expect(at(after, a.matchNumber).status).toBe('ready');
    expect(at(after, b.matchNumber).status).toBe('ready');
    expect(plan.entryChanges.map((c) => c.matchId).sort()).toEqual([a.id, b.id].sort());
    // The stored draw follows; positions and links are untouched.
    const drawn = plan.structure.winners.find((m) => m.matchNumber === b.matchNumber)!;
    expect(drawn.competitor2Id).toBe(personA);
    expect(plan.structure.positions).toEqual(s.positions);
    expect(plan.structure.winners.map((m) => m.nextWinnerMatch)).toEqual(s.winners.map((m) => m.nextWinnerMatch));
    expect(plan.structure.competitorCount).toBe(8);
  });

  it('moves a person into an empty spot: the old bye is re-decided and later rounds follow', () => {
    const s = generateBracket(seeds(6));
    const rows = rowsFor(s);
    const entries = entryRows(s, rows);
    const byeMatch = entries.find((m) => m.status === 'completed')!;
    const fullMatch = entries.find((m) => m.status === 'ready')!;
    const byeWinner = byeMatch.winnerId!;
    const next = s.winners.find((m) => m.matchNumber === byeMatch.matchNumber)!.nextWinnerMatch!;
    expect([at(rows, next).competitor1Id, at(rows, next).competitor2Id]).toContain(byeWinner);

    const emptySlot = byeMatch.competitor1Id ? 2 : 1;
    const mover = fullMatch.competitor1Id!;
    const { rows: after } = edit(s, rows, {
      action: 'move', registrationId: mover,
      from: { matchId: fullMatch.id, slot: 1 }, to: { matchId: byeMatch.id, slot: emptySlot },
    });
    const target = at(after, byeMatch.matchNumber);
    expect(target.status).toBe('ready');
    expect(target.winnerId).toBeNull();
    expect([target.competitor1Id, target.competitor2Id]).toEqual(expect.arrayContaining([byeWinner, mover]));
    // The bye winner no longer sits in the next round.
    expect([at(after, next).competitor1Id, at(after, next).competitor2Id]).not.toContain(byeWinner);
    // The source match is now a bye for the person left behind.
    const source = at(after, fullMatch.matchNumber);
    expect(source.status).toBe('completed');
    expect(source.notes).toBe('BYE');
    expect(source.winnerId).toBe(fullMatch.competitor2Id);
    // Engine agrees the result is settled.
    expect(computeBracketSync(s, after)).toEqual([]);
  });

  it('takes a person out: their opponent gets a bye that advances', () => {
    const s = generateBracket(seeds(8));
    const rows = rowsFor(s);
    const m = entryRows(s, rows)[0];
    const out = m.competitor2Id!;
    const { plan, rows: after } = edit(s, rows, { action: 'remove', registrationId: out, from: { matchId: m.id, slot: 2 } });
    const row = at(after, m.matchNumber);
    expect(row.competitor2Id).toBeNull();
    expect(row.status).toBe('completed');
    expect(row.winnerId).toBe(m.competitor1Id);
    const next = s.winners.find((w) => w.matchNumber === m.matchNumber)!.nextWinnerMatch!;
    expect([at(after, next).competitor1Id, at(after, next).competitor2Id]).toContain(m.competitor1Id);
    expect(plan.structure.competitorCount).toBe(7);
    expect(plan.downstream.length).toBeGreaterThan(0);
    expect(computeBracketSync(s, after)).toEqual([]);
  });

  it('puts a division member who is not in the bracket into an empty spot', () => {
    const s = generateBracket(seeds(5));
    const rows = rowsFor(s);
    const byeMatch = entryRows(s, rows).find((m) => m.status === 'completed')!;
    const slot = byeMatch.competitor1Id ? 2 : 1;
    const { plan, rows: after } = edit(s, rows, { action: 'place', registrationId: 'reg-6', to: { matchId: byeMatch.id, slot } });
    const row = at(after, byeMatch.matchNumber);
    expect(row.status).toBe('ready');
    expect([row.competitor1Id, row.competitor2Id]).toContain('reg-6');
    expect(plan.structure.competitorCount).toBe(6);
    expect(computeBracketSync(s, after)).toEqual([]);
  });

  it('refuses a played or started first-round match with 409', () => {
    const s = generateBracket(seeds(8));
    let rows = rowsFor(s);
    const [a, b] = entryRows(s, rows);
    rows = play(s, rows, a.matchNumber, 1);
    expectAppError(() => planSlotEdit(s, rows, {
      action: 'move', registrationId: b.competitor1Id!,
      from: { matchId: b.id, slot: 1 }, to: { matchId: a.id, slot: 2 },
    }, division(8)), 409, /already been played/);

    rows = rows.map((r) => (r.id === b.id ? { ...r, status: 'in_progress' } : r));
    expectAppError(() => planSlotEdit(s, rows, { action: 'remove', registrationId: b.competitor1Id!, from: { matchId: b.id, slot: 1 } }, division(8)), 409, /already started/);
  });

  it('refuses when a later match that would change has already been played', () => {
    const s = generateBracket(seeds(6));
    let rows = rowsFor(s);
    const entries = entryRows(s, rows);
    const byeMatch = entries.find((m) => m.status === 'completed')!;
    const next = s.winners.find((m) => m.matchNumber === byeMatch.matchNumber)!.nextWinnerMatch!;
    // Play the real match that feeds the same next-round match, then start it.
    const sibling = entries.find((m) => m.status === 'ready' && s.winners.find((w) => w.matchNumber === m.matchNumber)!.nextWinnerMatch === next)!;
    rows = play(s, rows, sibling.matchNumber, 1);
    rows = rows.map((r) => (r.matchNumber === next ? { ...r, status: 'in_progress' } : r));
    expectAppError(() => planSlotEdit(s, rows, {
      action: 'place', registrationId: 'reg-7', to: { matchId: byeMatch.id, slot: byeMatch.competitor1Id ? 2 : 1 },
    }, division(6)), 409, /later match/);
  });

  it('rejects stale, invalid or empty edits', () => {
    const s = generateBracket(seeds(4));
    const rows = rowsFor(s);
    const [a, b] = entryRows(s, rows);
    // The spot no longer holds that person.
    expectAppError(() => planSlotEdit(s, rows, { action: 'remove', registrationId: 'reg-99', from: { matchId: a.id, slot: 1 } }, division(4)), 409, /changed/);
    // Not in this division.
    expectAppError(() => planSlotEdit(s, rows, { action: 'place', registrationId: 'stranger', to: { matchId: a.id, slot: 1 } }, division(4)), 400, /not in this division/);
    // Already in the bracket.
    expectAppError(() => planSlotEdit(s, rows, { action: 'place', registrationId: a.competitor1Id!, to: { matchId: b.id, slot: 1 } }, division(4)), 409, /already in the bracket/);
    // Spot taken.
    expectAppError(() => planSlotEdit(s, rows, { action: 'place', registrationId: 'reg-5', to: { matchId: b.id, slot: 1 } }, division(4)), 409, /taken/);
    // A later-round spot.
    const later = rows.find((r) => !entryMatchNumbers(s).has(r.matchNumber))!;
    expectAppError(() => planSlotEdit(s, rows, { action: 'move', registrationId: a.competitor1Id!, from: { matchId: a.id, slot: 1 }, to: { matchId: later.id, slot: 1 } }, division(4)), 400, /first-round/);
    // Same spot.
    expectAppError(() => planSlotEdit(s, rows, { action: 'move', registrationId: a.competitor1Id!, from: { matchId: a.id, slot: 1 }, to: { matchId: a.id, slot: 1 } }, division(4)), 400, /different spot/);
    // Unknown match.
    expectAppError(() => planSlotEdit(s, rows, { action: 'place', registrationId: 'reg-5', to: { matchId: 'nope', slot: 1 } }, division(4)), 409, /not in this bracket/);
  });

  it('refuses round robin and emptying the whole bracket', () => {
    const rr = generateRoundRobin(seeds(3));
    expectAppError(() => planSlotEdit(rr, [], { action: 'place', registrationId: 'reg-1', to: { matchId: 'x', slot: 1 } }, division(3)), 400, /elimination/);

    const s = generateSingleElimination(seeds(1));
    const rows = rowsFor(s);
    const only = rows[0];
    expectAppError(() => planSlotEdit(s, rows, { action: 'remove', registrationId: only.competitor1Id!, from: { matchId: only.id, slot: 1 } }, division(1)), 400, /at least one/);
  });

  it('works on single elimination and keeps later rounds consistent', () => {
    const s = generateSingleElimination(seeds(8));
    let rows = rowsFor(s);
    const [a, , c] = entryRows(s, rows);
    const { rows: after } = edit(s, rows, {
      action: 'move', registrationId: a.competitor2Id!,
      from: { matchId: a.id, slot: 2 }, to: { matchId: c.id, slot: 1 },
    });
    rows = after;
    expect(at(rows, c.matchNumber).competitor1Id).toBe(a.competitor2Id);
    expect(at(rows, a.matchNumber).competitor2Id).toBe(c.competitor1Id);
    expect(computeBracketSync(s, rows)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { findUndoneMatchIndex, latestCompletedMatchId } from './scorekeeper-undo.js';

describe('scorekeeper undo selection', () => {
  it('selects the highest-numbered completed match from the full division', () => {
    expect(latestCompletedMatchId([
      { id: 'ready', matchNumber: 9, status: 'ready' },
      { id: 'completed-2', matchNumber: 2, status: 'completed' },
      { id: 'completed-7', matchNumber: 7, status: 'completed' },
    ])).toBe('completed-7');
  });

  it('returns null when the division has no completed result', () => {
    expect(latestCompletedMatchId([{ id: 'ready', matchNumber: 1, status: 'ready' }])).toBeNull();
  });
});

/**
 * Closes the June 2026 audit flag: "Scorekeeper stale closure on Ctrl+Z".
 * After an undo, the local `currentMatchIndex` is stale — the helper
 * below re-derives it from the fresh server data so the scorekeeper is
 * parked on the just-undone match.
 */
describe('scorekeeper undo cursor', () => {
  it('returns the index of the undone match in the new ready list', () => {
    // Server-after-undo state: the undone match is back in 'ready' state
    // and the other matches are still 'completed' (because they were
    // recorded before the undone one and not affected by the undo).
    const divisions = [
      {
        id: 'div-A',
        bracket: {
          matches: [
            { id: 'm-1', matchNumber: 1, status: 'completed' },
            { id: 'm-2', matchNumber: 2, status: 'ready' }, // ← just undone
            { id: 'm-3', matchNumber: 3, status: 'in_progress' },
            { id: 'm-4', matchNumber: 4, status: 'ready' },
          ],
        },
      },
    ];
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-2')).toBe(0);
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-3')).toBe(1);
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-4')).toBe(2);
  });

  it('returns -1 when the undone match belongs to a different division', () => {
    // Scorekeeper is working on div-B but undid the last completed match
    // in div-A. The cursor should stay on the scorekeeper's current
    // division (i.e. the helper returns -1 and the caller leaves the
    // currentMatchIndex alone).
    const divisions = [
      {
        id: 'div-A',
        bracket: {
          matches: [{ id: 'm-A-1', matchNumber: 1, status: 'ready' }],
        },
      },
      {
        id: 'div-B',
        bracket: {
          matches: [{ id: 'm-B-1', matchNumber: 1, status: 'ready' }],
        },
      },
    ];
    expect(findUndoneMatchIndex(divisions, 'div-B', 'm-A-1')).toBe(-1);
  });

  it('returns -1 for missing inputs (defensive)', () => {
    const divisions = [
      {
        id: 'div-A',
        bracket: {
          matches: [{ id: 'm-1', matchNumber: 1, status: 'ready' }],
        },
      },
    ];
    expect(findUndoneMatchIndex(null, 'div-A', 'm-1')).toBe(-1);
    expect(findUndoneMatchIndex(undefined, 'div-A', 'm-1')).toBe(-1);
    expect(findUndoneMatchIndex(divisions, null, 'm-1')).toBe(-1);
    expect(findUndoneMatchIndex(divisions, undefined, 'm-1')).toBe(-1);
    expect(findUndoneMatchIndex(divisions, '', 'm-1')).toBe(-1);
    expect(findUndoneMatchIndex(divisions, 'div-A', '')).toBe(-1);
  });

  it('returns -1 when the division has no bracket (data not yet loaded)', () => {
    const divisions = [
      { id: 'div-A', bracket: null },
    ];
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-1')).toBe(-1);
  });

  it('skips completed and pending matches when building the cursor list', () => {
    // Only ready / in_progress matches appear in readyMatches. The undone
    // match should be findable in the resulting filtered + sorted list.
    const divisions = [
      {
        id: 'div-A',
        bracket: {
          matches: [
            { id: 'm-1', matchNumber: 1, status: 'completed' },
            { id: 'm-2', matchNumber: 2, status: 'pending' },
            { id: 'm-3', matchNumber: 3, status: 'in_progress' },
            { id: 'm-4', matchNumber: 4, status: 'ready' },
          ],
        },
      },
    ];
    // After filtering out completed + pending, the remaining matches are
    // m-3 (matchNumber 3) and m-4 (matchNumber 4). Sorted by matchNumber,
    // m-3 is at index 0 and m-4 is at index 1.
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-3')).toBe(0);
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-4')).toBe(1);
  });

  it('returns -1 when the undone match is no longer in the fresh data', () => {
    // Edge case: race between undo and another mutation. The undone match
    // is gone from the fresh data — the caller leaves the cursor alone.
    const divisions = [
      {
        id: 'div-A',
        bracket: {
          matches: [{ id: 'm-1', matchNumber: 1, status: 'ready' }],
        },
      },
    ];
    expect(findUndoneMatchIndex(divisions, 'div-A', 'm-ghost')).toBe(-1);
  });
});

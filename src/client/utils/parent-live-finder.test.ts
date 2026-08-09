import { describe, expect, it } from 'vitest';
import {
  buildParentMatchView,
  filterParentMatches,
  readParentFavorites,
  writeParentFavorites,
  describeParentMatchTransition,
  parseParentScoreboardPayload,
} from './parent-live-finder';

const match = (overrides: Record<string, unknown> = {}) => ({
  id: 'match-1', matchNumber: 7, roundNumber: 1, bracketType: 'winners', status: 'ready', ringNumber: 3,
  score1: null, score2: null, winnerId: null,
  scheduledTime: '2030-01-01T15:30:00.000Z', divisionName: 'Junior Sparring',
  competitor1: { id: 'r1', competitor: { firstName: 'Amina', lastName: 'Khan', schoolDojang: 'North Star' } },
  competitor2: { id: 'r2', competitor: { firstName: 'Minho', lastName: 'Lee', schoolDojang: 'East Gate' } },
  ...overrides,
});

describe('parent live finder', () => {
  it('finds matches by athlete, division, and school without case sensitivity', () => {
    const matches = [match(), match({
      id: 'match-2', divisionName: 'Senior Patterns',
      competitor1: { id: 'r3', competitor: { firstName: 'Jordan', lastName: 'Smith', schoolDojang: 'West Club' } },
      competitor2: null,
    })];
    expect(filterParentMatches(matches, 'amina').map((item) => item.id)).toEqual(['match-1']);
    expect(filterParentMatches(matches, 'JUNIOR').map((item) => item.id)).toEqual(['match-1']);
    expect(filterParentMatches(matches, 'east gate').map((item) => item.id)).toEqual(['match-1']);
  });

  it('gives a parent plain-language ring, status, and local schedule details', () => {
    const view = buildParentMatchView(match(), 'en-CA', 'America/Toronto');
    expect(view.location).toBe('Ring 3');
    expect(view.status).toBe('Up next');
    expect(view.schedule).toContain('10:30');
    expect(view.schedule).toContain('local');
  });

  it('persists only match IDs and fails closed on malformed storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    writeParentFavorites(storage, 'tournament-1', new Set(['match-1', 'match-2']));
    expect(readParentFavorites(storage, 'tournament-1')).toEqual(new Set(['match-1', 'match-2']));
    values.set('bowin.parentFavorites.v1.tournament-1', '{bad');
    expect(readParentFavorites(storage, 'tournament-1')).toEqual(new Set());
  });

  it('announces only meaningful status or ring changes for favorite matches', () => {
    const before = [match()];
    const after = [match({ status: 'in_progress' })];
    expect(describeParentMatchTransition(before, after, new Set(['match-1']))).toContain('Amina Khan');
    expect(describeParentMatchTransition(before, after, new Set())).toBe('');
    expect(describeParentMatchTransition(after, after, new Set(['match-1']))).toBe('');
  });

  it('announces every favorite status or schedule change in one poll', () => {
    const before = [match(), match({ id: 'match-2', scheduledTime: null })];
    const after = [match({ status: 'in_progress' }), match({ id: 'match-2', scheduledTime: '2030-01-01T16:00:00.000Z' })];
    const announcement = describeParentMatchTransition(before, after, new Set(['match-1', 'match-2']));
    expect(announcement).toContain('Competing now');
    expect(announcement).toContain('schedule changed');
  });

  it('rejects malformed public scoreboard payloads before they can render', () => {
    expect(() => parseParentScoreboardPayload({ divisions: [{ ...match(), bracket: null }], displaySettings: {} })).toThrow();
    expect(() => parseParentScoreboardPayload({
      divisions: [{ id: 'd1', name: 'Junior', eventType: 'sparring', bracket: { id: 'b1', matches: [match({ scheduledTime: 'not-a-date' })] } }],
      displaySettings: {},
    })).toThrow('scheduled time');
    const valid = {
      divisions: [{ id: 'd1', name: 'Junior', eventType: 'sparring', bracket: { id: 'b1', matches: [match()] } }],
      displaySettings: {},
    };
    expect(parseParentScoreboardPayload(valid).divisions).toHaveLength(1);
    for (const corrupt of [
      { ...valid, displaySettings: { mode: {} } },
      { ...valid, divisions: [{ ...valid.divisions[0], bracket: { ...valid.divisions[0].bracket, matches: [match({ score1: { bad: true } })] } }] },
      { ...valid, divisions: [{ ...valid.divisions[0], bracket: { ...valid.divisions[0].bracket, matches: [match({ competitor1: { id: 'r1', competitor: { firstName: 'Amina', lastName: 'Khan', schoolDojang: { bad: true } } } })] } }] },
    ]) expect(() => parseParentScoreboardPayload(corrupt)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { matchSpecialNeeds } from './special-needs';

describe('matchSpecialNeeds', () => {
  it('keeps only the people in the match who have a note, in slot order', () => {
    expect(matchSpecialNeeds([
      { id: 'r1', specialNeeds: null, competitor: { firstName: 'Ana', lastName: 'Lee', specialNeeds: null } },
      { id: 'r2', specialNeeds: ' Asthma inhaler ', competitor: { firstName: 'Bo', lastName: 'Kim', specialNeeds: null } },
    ])).toEqual([{ registrationId: 'r2', name: 'Bo Kim', note: 'Asthma inhaler' }]);
  });

  it('puts the note for this event first, then the one on file', () => {
    expect(matchSpecialNeeds([
      { id: 'r1', specialNeeds: 'Quiet warm-up', competitor: { firstName: 'Ana', lastName: 'Lee', specialNeeds: 'Epipen' } },
      { id: 'r2', competitor: { firstName: 'Bo', lastName: 'Kim', specialNeeds: 'Glasses' } },
    ])).toEqual([
      { registrationId: 'r1', name: 'Ana Lee', note: 'Quiet warm-up · Epipen' },
      { registrationId: 'r2', name: 'Bo Kim', note: 'Glasses' },
    ]);
  });

  it('skips empty slots', () => {
    expect(matchSpecialNeeds([null, undefined])).toEqual([]);
  });
});

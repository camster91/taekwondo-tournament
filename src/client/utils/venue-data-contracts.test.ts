import { describe, expect, it } from 'vitest';
import { isCheckInRegistrationData, isScorekeeperDivisionData } from './venue-data-contracts.js';

describe('venue snapshot runtime contracts', () => {
  it('accepts complete check-in rows and rejects incomplete personal data', () => {
    const row = {
      id: 'registration-1', patterns: true, sparring: false, weightAtRegistration: null, ageAtTournament: 12,
      checkedIn: false, checkInTime: null, checkInWeight: null,
      competitor: { id: 'competitor-1', firstName: 'Amina', lastName: 'Kim', gender: 'F', belt: 'Red', schoolDojang: 'Demo', weightLbs: null },
    };
    expect(isCheckInRegistrationData([row])).toBe(true);
    expect(isCheckInRegistrationData([{ ...row, competitor: { id: 'competitor-1' } }])).toBe(false);
  });

  it('accepts complete scorekeeper divisions and rejects malformed matches', () => {
    const division = {
      id: 'division-1', name: 'Patterns', eventType: 'patterns',
      bracket: { id: 'bracket-1', matches: [{
        id: 'match-1', matchNumber: 1, roundNumber: 1, bracketType: 'winners', ringNumber: 1,
        status: 'ready', score1: null, score2: null, winnerId: null, competitor1: null, competitor2: null,
      }] },
    };
    expect(isScorekeeperDivisionData([division])).toBe(true);
    expect(isScorekeeperDivisionData([{ ...division, bracket: { id: 'bracket-1', matches: [{ id: 'match-1' }] } }])).toBe(false);
  });
});

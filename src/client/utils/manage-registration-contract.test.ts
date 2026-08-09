import { describe, expect, it } from 'vitest';
import { managedRegistrationMatchesUpdate, normalizeManagedRegistrationUpdate, parseManagedRegistrationResponse } from './manage-registration-contract.js';

const registration = {
  confirmationCode: '12345678', firstName: 'Amina', lastName: 'Kim',
  dateOfBirth: '2016-01-15T00:00:00.000Z', gender: 'F', belt: 'Yellow', weight: 80,
  school: 'Fabricated Dojang', specialNeeds: null, competeWithOlder: false,
  patterns: true, sparring: false,
  tournamentId: '00000000-0000-4000-8000-000000000010', tournamentName: 'Fabricated Open',
  tournamentDate: '2027-12-31T15:00:00.000Z', tournamentStatus: 'registration', checkedIn: false,
};

describe('managed registration response', () => {
  it('accepts the complete server payload', () => {
    expect(parseManagedRegistrationResponse({ registration })).toEqual({ registration });
  });

  it.each([
    null,
    {},
    { registration: null },
    { registration: { ...registration, confirmationCode: '' } },
    { registration: { ...registration, confirmationCode: 'not-code' } },
    { registration: { ...registration, tournamentId: 'not-a-uuid' } },
    { registration: { ...registration, gender: 'X' } },
    { registration: { ...registration, tournamentStatus: 'banana' } },
    { registration: { ...registration, weight: '80' } },
    { registration: { ...registration, patterns: 'yes' } },
    { registration: { ...registration, tournamentDate: 'not-a-date' } },
    { registration: { ...registration, checkedIn: 'false' } },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseManagedRegistrationResponse(payload)).toThrow('Registration status could not be verified');
  });

  it('confirms only the normalized editable values submitted', () => {
    const expected = normalizeManagedRegistrationUpdate({ ...registration, firstName: '  Amira  ', school: '' });
    expect(managedRegistrationMatchesUpdate({ ...registration, firstName: 'Amira', school: null }, expected)).toBe(true);
    expect(managedRegistrationMatchesUpdate(registration, expected)).toBe(false);
  });
});

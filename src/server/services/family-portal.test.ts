import { describe, expect, it } from 'vitest';
import { familyRegistrationWhere, nextMatchFor, normalizeFamilyEmail, registrationStatusFor } from './family-portal';

describe('family portal helpers', () => {
  it('normalizes emails', () => {
    expect(normalizeFamilyEmail('  Parent@Example.COM ')).toBe('parent@example.com');
  });

  it('only matches live tournaments and competitors, case-insensitively', () => {
    expect(familyRegistrationWhere('a@b.co')).toEqual({
      parentEmail: { equals: 'a@b.co', mode: 'insensitive' },
      tournament: { deletedAt: null },
      competitor: { deletedAt: null },
    });
  });

  it('labels registration status', () => {
    expect(registrationStatusFor({ checkedIn: true, waitlistStatus: 'active' })).toBe('checked_in');
    expect(registrationStatusFor({ checkedIn: false, waitlistStatus: 'waitlisted' })).toBe('waitlisted');
    expect(registrationStatusFor({ checkedIn: false, waitlistStatus: 'withdrawn' })).toBe('withdrawn');
    expect(registrationStatusFor({ checkedIn: false, waitlistStatus: null })).toBe('registered');
  });

  it('finds the earliest unfinished match for the registration', () => {
    const base = { competitor2Id: 'x', ringNumber: 1, scheduledTime: null };
    const matches = [
      { ...base, matchNumber: 1, status: 'completed', competitor1Id: 'r1' },
      { ...base, matchNumber: 4, status: 'pending', competitor1Id: 'r1', ringNumber: 2, scheduledTime: new Date('2026-10-10T10:30:00Z') },
      { ...base, matchNumber: 3, status: 'ready', competitor1Id: 'r1', ringNumber: 3, scheduledTime: new Date('2026-10-10T10:00:00Z') },
      { ...base, matchNumber: 2, status: 'ready', competitor1Id: 'other' },
    ];
    expect(nextMatchFor('r1', matches)).toEqual({ ringNumber: 3, scheduledTime: new Date('2026-10-10T10:00:00Z') });
    expect(nextMatchFor('nobody', matches)).toBeNull();
  });
});

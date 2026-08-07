import { describe, expect, it } from 'vitest';
import {
  canCreateTournament,
  canOpenPublicRegistration,
  getPlanEntitlements,
  normalizePlan,
} from './entitlements.js';

describe('normalizePlan', () => {
  it('fails closed to free for unknown persisted plan values', () => {
    expect(normalizePlan('enterprise-ish')).toBe('free');
    expect(normalizePlan(null)).toBe('free');
  });
});

describe('plan entitlements', () => {
  it('keeps free organizations in evaluation mode without public registration', () => {
    expect(getPlanEntitlements('free')).toEqual({
      maxTournaments: 1,
      maxMembers: 1,
      maxRings: 1,
      publicRegistration: false,
      eventOperations: false,
    });
    expect(canCreateTournament('free', 0)).toBe(true);
    expect(canCreateTournament('free', 1)).toBe(false);
    expect(canOpenPublicRegistration('free')).toBe(false);
  });

  it('supports the supervised managed-pilot event envelope', () => {
    expect(getPlanEntitlements('pilot')).toEqual({
      maxTournaments: 5,
      maxMembers: 10,
      maxRings: 6,
      publicRegistration: true,
      eventOperations: true,
    });
    expect(canCreateTournament('pilot', 4)).toBe(true);
    expect(canCreateTournament('pilot', 5)).toBe(false);
    expect(canOpenPublicRegistration('pilot')).toBe(true);
  });

  it('provides explicit starter and pro limits', () => {
    expect(getPlanEntitlements('starter').maxTournaments).toBe(10);
    expect(getPlanEntitlements('pro').maxTournaments).toBe(100);
    expect(getPlanEntitlements('pro').maxRings).toBe(32);
  });
});

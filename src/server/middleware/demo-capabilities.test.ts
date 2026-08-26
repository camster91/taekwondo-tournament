import { describe, expect, it } from 'vitest';
import { isDemoRequestAllowed } from './auth.js';

describe('demo session capability boundary', () => {
  it('allows read-only tournament operations and caller logout', () => {
    expect(isDemoRequestAllowed('GET', '/api/tournaments')).toBe(true);
    expect(isDemoRequestAllowed('GET', '/api/divisions/tournament-id')).toBe(true);
    expect(isDemoRequestAllowed('POST', '/api/auth/logout')).toBe(true);
  });

  it('allows only the two guided synthetic-data mutation families', () => {
    expect(isDemoRequestAllowed('PUT', '/api/brackets/match/match-id')).toBe(true);
    expect(isDemoRequestAllowed('PUT', '/api/tournaments/tournament-id/registrations/registration-id')).toBe(true);
    expect(isDemoRequestAllowed('PUT', '/api/tournaments/tournament-id')).toBe(false);
    expect(isDemoRequestAllowed('DELETE', '/api/tournaments/tournament-id')).toBe(false);
  });

  it('blocks administrative reads and every external side-effect surface', () => {
    expect(isDemoRequestAllowed('GET', '/api/auth/users')).toBe(false);
    expect(isDemoRequestAllowed('GET', '/api/invites')).toBe(false);
    expect(isDemoRequestAllowed('POST', '/api/invites')).toBe(false);
    expect(isDemoRequestAllowed('POST', '/api/tournaments/id/broadcast')).toBe(false);
    expect(isDemoRequestAllowed('POST', '/api/billing/checkout')).toBe(false);
    expect(isDemoRequestAllowed('GET', '/api/organizations')).toBe(false);
    expect(isDemoRequestAllowed('GET', '/api/support')).toBe(false);
    expect(isDemoRequestAllowed('GET', '/api/support/ticket-id')).toBe(false);
    expect(isDemoRequestAllowed('GET', '/API/AUTH/USERS?limit=10')).toBe(false);
  });
});

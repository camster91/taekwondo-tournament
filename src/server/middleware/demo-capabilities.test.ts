import { describe, expect, it } from 'vitest';
import { isDemoRequestAllowed, isDemoUser, DEMO_ORG_ID, DEMO_ROLE } from './auth.js';

describe('demo session capability boundary', () => {
  it('allows read-only tournament operations and caller logout', () => {
    expect(isDemoRequestAllowed('GET', '/api/tournaments')).toBe(true);
    expect(isDemoRequestAllowed('GET', '/api/divisions/tournament-id')).toBe(true);
    expect(isDemoRequestAllowed('POST', '/api/auth/logout')).toBe(true);
  });

  // SH-3: with the demo user scoped to a synthetic org, every write
  // other than `POST /api/auth/logout` is denied. The prior
  // bracket/registration/incident writes — which previously slipped
  // through the per-method allowlist and let a demo visitor mutate
  // real tournament state — are now blocked.
  it('denies every write path that is not the explicit logout allowance', () => {
    expect(isDemoRequestAllowed('PUT', '/api/brackets/match/match-id')).toBe(false);
    expect(isDemoRequestAllowed('POST', '/api/brackets/match/match-id/undo')).toBe(false);
    expect(isDemoRequestAllowed('PUT', '/api/tournaments/tournament-id/registrations/registration-id')).toBe(false);
    expect(isDemoRequestAllowed('POST', '/api/incidents')).toBe(false);
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

  it('exposes the synthetic tenant id and demo role as the contract', () => {
    expect(DEMO_ROLE).toBe('demo');
    expect(DEMO_ORG_ID).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('identifies demo sessions from either the role or the isDemo flag', () => {
    expect(isDemoUser({ role: 'demo', isDemo: true })).toBe(true);
    expect(isDemoUser({ role: 'demo', isDemo: false })).toBe(true);
    expect(isDemoUser({ role: 'admin', isDemo: true })).toBe(true);
    expect(isDemoUser({ role: 'admin', isDemo: false })).toBe(false);
    expect(isDemoUser({ role: 'director', isDemo: true })).toBe(true);
    expect(isDemoUser(undefined)).toBe(false);
    expect(isDemoUser(null)).toBe(false);
  });
});


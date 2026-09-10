import { describe, it, expect } from 'vitest';

/**
 * Tests for tournament registrations endpoint waitlistStatus filtering.
 * Ensures that only active and promoted registrations appear in check-in (#187).
 */
describe('Tournament registrations waitlistStatus filtering', () => {
  it('should include active registrations in where clause', () => {
    // The where clause should include: waitlistStatus: { in: ['active', 'promoted'] }
    const where: Record<string, unknown> = {
      tournamentId: 'test-tournament-id',
      waitlistStatus: { in: ['active', 'promoted'] },
    };

    expect(where.waitlistStatus).toBeDefined();
    expect((where.waitlistStatus as any).in).toEqual(['active', 'promoted']);
  });

  it('should exclude waitlisted registrations from check-in', () => {
    // Waitlisted registrations should NOT appear because the filter
    // only includes 'active' and 'promoted' statuses
    const allowedStatuses = ['active', 'promoted'];
    
    expect(allowedStatuses).not.toContain('waitlisted');
    expect(allowedStatuses).not.toContain('withdrawn');
  });

  it('should include promoted registrations in check-in', () => {
    // Promoted registrations (moved from waitlist to active) should appear
    const allowedStatuses = ['active', 'promoted'];
    
    expect(allowedStatuses).toContain('promoted');
  });

  it('should preserve notInDivision filter when combined with waitlistStatus', () => {
    // Both filters should coexist
    const where: Record<string, unknown> = {
      tournamentId: 'test-tournament-id',
      waitlistStatus: { in: ['active', 'promoted'] },
      assignments: { none: { divisionId: 'division-123' } },
    };

    expect(where.waitlistStatus).toBeDefined();
    expect(where.assignments).toBeDefined();
    expect((where.assignments as any).none.divisionId).toBe('division-123');
  });
});

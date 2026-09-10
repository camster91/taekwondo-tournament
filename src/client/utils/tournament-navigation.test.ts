import { describe, it, expect } from 'vitest';
import {
  getTournamentDestination,
  getTournamentPrimaryActionLabel,
  getTournamentPrimaryActionAriaLabel,
} from './tournament-navigation';

describe('tournament-navigation', () => {
  it('resolves completed tournaments to /tournaments/:id/results with View Results label and aria-label', () => {
    const tournament = {
      id: 'tour-123',
      name: 'Spring Championship 2026',
      status: 'completed',
    };

    expect(getTournamentDestination(tournament)).toBe('/tournaments/tour-123/results');
    expect(getTournamentPrimaryActionLabel(tournament)).toBe('View Results');
    expect(getTournamentPrimaryActionAriaLabel(tournament)).toBe(
      'View results for Spring Championship 2026'
    );
  });

  it('resolves active, draft, or in_progress tournaments to /tournaments/:id with Manage label and aria-label', () => {
    const statuses = ['draft', 'active', 'in_progress', 'registration', 'upcoming'];

    for (const status of statuses) {
      const tournament = {
        id: 'tour-456',
        name: 'Fall Open 2026',
        status,
      };

      expect(getTournamentDestination(tournament)).toBe('/tournaments/tour-456');
      expect(getTournamentPrimaryActionLabel(tournament)).toBe('Manage');
      expect(getTournamentPrimaryActionAriaLabel(tournament)).toBe('Manage Fall Open 2026');
    }
  });
});

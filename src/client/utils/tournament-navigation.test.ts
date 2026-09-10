import { describe, it, expect } from 'vitest';
import {
  getTournamentDestination,
  getTournamentPrimaryActionLabel,
  getTournamentPrimaryActionAriaLabel,
  getRoleAwareTournamentDestination,
  getRoleAwareTournamentLabel,
  getRoleAwareTournamentAriaLabel,
  type UserRole,
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

  describe('role-aware navigation', () => {
    const tournament = {
      id: 'tour-789',
      name: 'Summer Classic 2026',
    };

    describe('admin and director roles', () => {
      const roles: UserRole[] = ['admin', 'director'];

      for (const role of roles) {
        it(`${role}: routes to detail page for active tournaments`, () => {
          expect(getRoleAwareTournamentDestination({ ...tournament, status: 'draft' }, role))
            .toBe('/tournaments/tour-789');
          expect(getRoleAwareTournamentDestination({ ...tournament, status: 'in_progress' }, role))
            .toBe('/tournaments/tour-789');
          expect(getRoleAwareTournamentLabel({ status: 'draft' }, role))
            .toBe('Manage');
          expect(getRoleAwareTournamentAriaLabel({ ...tournament, status: 'draft' }, role))
            .toBe('Manage for Summer Classic 2026');
        });

        it(`${role}: routes to results page for completed tournaments`, () => {
          expect(getRoleAwareTournamentDestination({ ...tournament, status: 'completed' }, role))
            .toBe('/tournaments/tour-789/results');
          expect(getRoleAwareTournamentLabel({ status: 'completed' }, role))
            .toBe('View Results');
          expect(getRoleAwareTournamentAriaLabel({ ...tournament, status: 'completed' }, role))
            .toBe('View Results for Summer Classic 2026');
        });
      }
    });

    describe('scorekeeper role', () => {
      it('routes to scorekeeper view during in_progress tournaments', () => {
        expect(getRoleAwareTournamentDestination({ ...tournament, status: 'in_progress' }, 'scorekeeper'))
          .toBe('/tournaments/tour-789/scorekeeper');
        expect(getRoleAwareTournamentLabel({ status: 'in_progress' }, 'scorekeeper'))
          .toBe('Score Matches');
        expect(getRoleAwareTournamentAriaLabel({ ...tournament, status: 'in_progress' }, 'scorekeeper'))
          .toBe('Score Matches for Summer Classic 2026');
      });

      it('routes to results for non-in_progress tournaments', () => {
        expect(getRoleAwareTournamentDestination({ ...tournament, status: 'draft' }, 'scorekeeper'))
          .toBe('/tournaments/tour-789/results');
        expect(getRoleAwareTournamentDestination({ ...tournament, status: 'completed' }, 'scorekeeper'))
          .toBe('/tournaments/tour-789/results');
        expect(getRoleAwareTournamentLabel({ status: 'draft' }, 'scorekeeper'))
          .toBe('View Results');
      });
    });

    describe('viewer and public roles', () => {
      const roles: UserRole[] = ['viewer', 'public'];

      for (const role of roles) {
        it(`${role}: always routes to results page`, () => {
          expect(getRoleAwareTournamentDestination({ ...tournament, status: 'draft' }, role))
            .toBe('/tournaments/tour-789/results');
          expect(getRoleAwareTournamentDestination({ ...tournament, status: 'in_progress' }, role))
            .toBe('/tournaments/tour-789/results');
          expect(getRoleAwareTournamentDestination({ ...tournament, status: 'completed' }, role))
            .toBe('/tournaments/tour-789/results');
          expect(getRoleAwareTournamentLabel({ status: 'draft' }, role))
            .toBe('View Results');
          expect(getRoleAwareTournamentAriaLabel({ ...tournament, status: 'in_progress' }, role))
            .toBe('View Results for Summer Classic 2026');
        });
      }
    });
  });
});

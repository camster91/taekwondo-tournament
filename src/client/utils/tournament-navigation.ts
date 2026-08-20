export interface NavigableTournament {
  id: string;
  name: string;
  status: string;
}

/**
 * Returns the primary URL destination for a tournament based on its lifecycle status.
 * Completed tournaments resolve to `/tournaments/:id/results`, active/upcoming resolve to `/tournaments/:id`.
 */
export function getTournamentDestination(tournament: Pick<NavigableTournament, 'id' | 'status'>): string {
  return tournament.status === 'completed'
    ? `/tournaments/${tournament.id}/results`
    : `/tournaments/${tournament.id}`;
}

/**
 * Returns the visible label for the primary tournament card action.
 */
export function getTournamentPrimaryActionLabel(tournament: Pick<NavigableTournament, 'status'>): 'View Results' | 'Manage' {
  return tournament.status === 'completed' ? 'View Results' : 'Manage';
}

/**
 * Returns the accessible aria-label for the primary tournament card action.
 */
export function getTournamentPrimaryActionAriaLabel(tournament: Pick<NavigableTournament, 'name' | 'status'>): string {
  return tournament.status === 'completed'
    ? `View results for ${tournament.name}`
    : `Manage ${tournament.name}`;
}

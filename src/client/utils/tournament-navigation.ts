export interface NavigableTournament {
  id: string;
  name: string;
  status: string;
}

export type UserRole = 'admin' | 'director' | 'scorekeeper' | 'viewer' | 'public';

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

/**
 * Returns the appropriate tournament destination based on user role and tournament status.
 * 
 * Role-based routing:
 * - Organizers/Directors: Full access, see detail/results based on status
 * - Scorekeepers: During event → scorekeeper view, otherwise → results
 * - Viewers/Public: Results-only access
 */
export function getRoleAwareTournamentDestination(
  tournament: Pick<NavigableTournament, 'id' | 'status'>,
  role: UserRole
): string {
  const tournamentId = tournament.id;
  const isCompleted = tournament.status === 'completed';
  const isInProgress = tournament.status === 'in_progress';

  // Admin and Director: full access, lifecycle-aware routing
  if (role === 'admin' || role === 'director') {
    return isCompleted
      ? `/tournaments/${tournamentId}/results`
      : `/tournaments/${tournamentId}`;
  }

  // Scorekeeper: during event → scorekeeper, otherwise → results
  if (role === 'scorekeeper') {
    return isInProgress
      ? `/tournaments/${tournamentId}/scorekeeper`
      : `/tournaments/${tournamentId}/results`;
  }

  // Viewer/Public: always results
  return `/tournaments/${tournamentId}/results`;
}

/**
 * Returns the visible label for role-aware tournament actions.
 */
export function getRoleAwareTournamentLabel(
  tournament: Pick<NavigableTournament, 'status'>,
  role: UserRole
): string {
  const isCompleted = tournament.status === 'completed';
  const isInProgress = tournament.status === 'in_progress';

  if (role === 'admin' || role === 'director') {
    return isCompleted ? 'View Results' : 'Manage';
  }

  if (role === 'scorekeeper') {
    return isInProgress ? 'Score Matches' : 'View Results';
  }

  return 'View Results';
}

/**
 * Returns the accessible aria-label for role-aware tournament actions.
 */
export function getRoleAwareTournamentAriaLabel(
  tournament: Pick<NavigableTournament, 'name' | 'status'>,
  role: UserRole
): string {
  const label = getRoleAwareTournamentLabel(tournament, role);
  return `${label} for ${tournament.name}`;
}

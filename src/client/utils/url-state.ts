/**
 * URL State Preservation Utilities
 * 
 * Preserves operational filters and selections in shareable URL state.
 * Critical for day-of operations where refreshing the page should not lose context.
 */

/**
 * Safely reads a search param value from URLSearchParams
 */
export function getSearchParam(params: URLSearchParams, key: string): string | null {
  return params.get(key);
}

/**
 * Safely reads a boolean search param (true if present and not explicitly 'false')
 */
export function getBooleanSearchParam(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  return value !== null && value !== 'false';
}

/**
 * Safely reads an integer search param with optional default
 */
export function getIntSearchParam(
  params: URLSearchParams,
  key: string,
  defaultValue?: number
): number | undefined {
  const value = params.get(key);
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely reads an array search param (comma-separated values)
 */
export function getArraySearchParam(params: URLSearchParams, key: string): string[] {
  const value = params.get(key);
  return value ? value.split(',').filter(Boolean) : [];
}

/**
 * Creates a new URLSearchParams with updated values, preserving existing params
 */
export function updateSearchParams(
  current: URLSearchParams,
  updates: Record<string, string | number | boolean | string[] | null | undefined>
): URLSearchParams {
  const newParams = new URLSearchParams(current);

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') {
      newParams.delete(key);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        newParams.delete(key);
      } else {
        newParams.set(key, value.join(','));
      }
    } else {
      newParams.set(key, String(value));
    }
  }

  return newParams;
}

/**
 * Check-in page filters
 */
export interface CheckInFilters {
  search?: string;
  showCheckedIn?: boolean;
  showUnchecked?: boolean;
  eventFilter?: 'all' | 'patterns' | 'sparring';
}

export function parseCheckInFilters(params: URLSearchParams): CheckInFilters {
  return {
    search: getSearchParam(params, 'search') || undefined,
    showCheckedIn: getBooleanSearchParam(params, 'showCheckedIn'),
    showUnchecked: getBooleanSearchParam(params, 'showUnchecked'),
    eventFilter: (getSearchParam(params, 'eventFilter') as CheckInFilters['eventFilter']) || 'all',
  };
}

export function serializeCheckInFilters(filters: CheckInFilters): Record<string, string | null> {
  return {
    search: filters.search || null,
    showCheckedIn: filters.showCheckedIn ? 'true' : null,
    showUnchecked: filters.showUnchecked ? 'true' : null,
    eventFilter: filters.eventFilter && filters.eventFilter !== 'all' ? filters.eventFilter : null,
  };
}

/**
 * Division page filters
 */
export interface DivisionFilters {
  eventType?: 'patterns' | 'sparring' | 'all';
  gender?: 'male' | 'female' | 'all';
  beltLevel?: string;
  search?: string;
}

export function parseDivisionFilters(params: URLSearchParams): DivisionFilters {
  return {
    eventType: (getSearchParam(params, 'eventType') as DivisionFilters['eventType']) || 'all',
    gender: (getSearchParam(params, 'gender') as DivisionFilters['gender']) || 'all',
    beltLevel: getSearchParam(params, 'beltLevel') || undefined,
    search: getSearchParam(params, 'search') || undefined,
  };
}

export function serializeDivisionFilters(filters: DivisionFilters): Record<string, string | null> {
  return {
    eventType: filters.eventType && filters.eventType !== 'all' ? filters.eventType : null,
    gender: filters.gender && filters.gender !== 'all' ? filters.gender : null,
    beltLevel: filters.beltLevel || null,
    search: filters.search || null,
  };
}

/**
 * Tournament list filters
 */
export interface TournamentListFilters {
  status?: 'draft' | 'registration' | 'in_progress' | 'completed' | 'all';
  search?: string;
  trash?: boolean;
}

export function parseTournamentListFilters(params: URLSearchParams): TournamentListFilters {
  return {
    status: (getSearchParam(params, 'status') as TournamentListFilters['status']) || 'all',
    search: getSearchParam(params, 'search') || undefined,
    trash: getBooleanSearchParam(params, 'trash'),
  };
}

export function serializeTournamentListFilters(
  filters: TournamentListFilters
): Record<string, string | null> {
  return {
    status: filters.status && filters.status !== 'all' ? filters.status : null,
    search: filters.search || null,
    trash: filters.trash ? 'true' : null,
  };
}

/**
 * Director dashboard filters
 */
export interface DirectorDashboardFilters {
  ring?: string;
  alertsOnly?: boolean;
}

export function parseDirectorDashboardFilters(params: URLSearchParams): DirectorDashboardFilters {
  return {
    ring: getSearchParam(params, 'ring') || undefined,
    alertsOnly: getBooleanSearchParam(params, 'alertsOnly'),
  };
}

export function serializeDirectorDashboardFilters(
  filters: DirectorDashboardFilters
): Record<string, string | null> {
  return {
    ring: filters.ring || null,
    alertsOnly: filters.alertsOnly ? 'true' : null,
  };
}

/**
 * Scorekeeper filters
 */
export interface ScorekeeperFilters {
  ring?: string;
  division?: string;
}

export function parseScorekeeperFilters(params: URLSearchParams): ScorekeeperFilters {
  return {
    ring: getSearchParam(params, 'ring') || undefined,
    division: getSearchParam(params, 'division') || undefined,
  };
}

export function serializeScorekeeperFilters(
  filters: ScorekeeperFilters
): Record<string, string | null> {
  return {
    ring: filters.ring || null,
    division: filters.division || null,
  };
}

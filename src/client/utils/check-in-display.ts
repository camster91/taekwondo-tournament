export function formatCheckInWeight(weight: number): string {
  return weight.toFixed(1);
}

export const CHECK_IN_ACCESSIBLE_LABELS = {
  back: 'Back to tournament',
  search: 'Search competitors by name or school',
  status: 'Filter by check-in status',
  event: 'Filter by event',
  school: 'Filter by school',
  sort: 'Sort competitors',
} as const;

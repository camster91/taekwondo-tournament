export function formatCheckInWeight(weight: number): string {
  return weight.toFixed(1);
}

export const CHECK_IN_ACCESSIBLE_LABELS = {
  back: 'Back to tournament',
  status: 'Filter by check-in status',
  event: 'Filter by event',
  school: 'Filter by school',
  sort: 'Sort competitors',
} as const;

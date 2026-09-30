// Operational staff duties (#192). Labels only: a duty never grants access.
export const STAFF_DUTIES = ['scorekeeper', 'ring_lead', 'official', 'check_in', 'runner', 'other'] as const;
export type StaffDuty = typeof STAFF_DUTIES[number];

export const STAFF_DUTY_LABELS: Record<StaffDuty, string> = {
  scorekeeper: 'Scorekeeper',
  ring_lead: 'Ring lead',
  official: 'Official',
  check_in: 'Check-in lead',
  runner: 'Runner',
  other: 'Other',
};

export function staffDutyLabel(duty: string): string {
  return (STAFF_DUTY_LABELS as Record<string, string>)[duty] ?? duty;
}

// Plain-language capacity messages for "Add competitors" on the
// tournament page. The server decides for real (free spots first, then
// the waiting list, else skipped); this only previews it from the
// tournament's capacity numbers and summarises the server's answer.

export interface CapacitySnapshot {
  maxCapacity: number | null;
  waitlistEnabled: boolean;
  spotsRemaining: number | null;
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * What adding `selected` new people will do, or null when everyone fits
 * (or the tournament has no capacity limit).
 */
export function bulkCapacityNotice(selected: number, capacity: CapacitySnapshot | null | undefined): string | null {
  if (!capacity || !capacity.maxCapacity || capacity.spotsRemaining == null) return null;
  const spots = Math.max(0, capacity.spotsRemaining);
  const overflow = selected - spots;
  if (overflow <= 0) return null;
  if (capacity.waitlistEnabled) {
    return spots === 0
      ? `The tournament is full. ${overflow === 1 ? 'This person' : `All ${overflow}`} will go to the waiting list.`
      : `Only ${spots} ${spots === 1 ? 'spot is' : 'spots are'} left. ${overflow} of these will go to the waiting list.`;
  }
  return spots === 0
    ? `The tournament is full. ${overflow} won't be added.`
    : `Only ${spots} ${spots === 1 ? 'spot is' : 'spots are'} left. ${overflow} won't be added.`;
}

export interface BulkAddResult {
  added?: number;
  waitlisted?: number;
  updated?: number;
  addedOverCapacity?: number;
  skippedCount?: number;
  skipped?: Array<{ name: string; reason: string }>;
}

/** Toast text and tone for the server's answer. */
export function bulkAddSummary(result: BulkAddResult, requested: number): { message: string; tone: 'success' | 'warning' } {
  if (typeof result.added !== 'number') {
    return { message: `Added ${people(requested)}.`, tone: 'success' };
  }
  const added = result.added + (result.updated ?? 0);
  const parts = [`Added ${people(added)}.`];
  if (result.addedOverCapacity) parts.push(`${result.addedOverCapacity} over capacity.`);
  if (result.waitlisted) parts.push(`${result.waitlisted} on the waiting list.`);
  const skipped = result.skippedCount ?? result.skipped?.length ?? 0;
  if (skipped) parts.push(`${skipped} not added: ${result.skipped?.[0]?.reason.toLowerCase() ?? 'the tournament is full'}.`);
  return { message: parts.join(' '), tone: skipped || result.waitlisted ? 'warning' : 'success' };
}

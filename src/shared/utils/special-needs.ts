// Special-needs notes (#15). A registration carries its own note for this
// tournament (Registration.specialNeeds) and the competitor may have a
// permanent one (Competitor.specialNeeds); public sign-up writes the same
// text to both. Staff see one combined line. Never shown on public pages.

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One readable line, or null when there is nothing to show. */
export function specialNeedsText(
  registrationNotes: string | null | undefined,
  competitorNotes: string | null | undefined,
): string | null {
  const forEvent = clean(registrationNotes);
  const onFile = clean(competitorNotes);
  if (forEvent && onFile && forEvent.toLowerCase() !== onFile.toLowerCase()) return `${forEvent} · ${onFile}`;
  return forEvent || onFile || null;
}

export interface MatchNoteSlot {
  id: string;
  specialNeeds?: string | null;
  competitor: { firstName: string; lastName: string; specialNeeds?: string | null };
}

export interface MatchSpecialNeedsEntry {
  registrationId: string;
  name: string;
  note: string;
}

/**
 * Notes for the people in one match (the scorekeeper view), in slot order.
 * Empty slots and people without a note are left out.
 */
export function matchSpecialNeeds(slots: Array<MatchNoteSlot | null | undefined>): MatchSpecialNeedsEntry[] {
  const entries: MatchSpecialNeedsEntry[] = [];
  for (const slot of slots) {
    if (!slot) continue;
    const note = specialNeedsText(slot.specialNeeds, slot.competitor.specialNeeds);
    if (!note) continue;
    entries.push({
      registrationId: slot.id,
      name: `${slot.competitor.firstName} ${slot.competitor.lastName}`.trim(),
      note,
    });
  }
  return entries;
}

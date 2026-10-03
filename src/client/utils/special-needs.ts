// Special-needs notes (#15). A registration carries its own note for this
// tournament (Registration.specialNeeds) and the competitor may have a
// permanent one (Competitor.specialNeeds); public sign-up writes the same
// text to both. Directors see one combined line. Never shown on public pages.

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

export interface SpecialNeedsEntry {
  registrationId: string;
  name: string;
  note: string;
}

interface RegistrationWithNotes {
  id: string;
  specialNeeds?: string | null;
  competitor: { firstName: string; lastName: string; specialNeeds?: string | null };
  assignments?: Array<{ division: { id: string } }>;
}

/** Division id -> competitors in it who have a special-needs note. */
export function specialNeedsByDivision(registrations: RegistrationWithNotes[]): Map<string, SpecialNeedsEntry[]> {
  const byDivision = new Map<string, SpecialNeedsEntry[]>();
  for (const registration of registrations) {
    const note = specialNeedsText(registration.specialNeeds, registration.competitor.specialNeeds);
    if (!note) continue;
    const entry = {
      registrationId: registration.id,
      name: `${registration.competitor.firstName} ${registration.competitor.lastName}`.trim(),
      note,
    };
    for (const assignment of registration.assignments ?? []) {
      const list = byDivision.get(assignment.division.id) ?? [];
      list.push(entry);
      byDivision.set(assignment.division.id, list);
    }
  }
  return byDivision;
}

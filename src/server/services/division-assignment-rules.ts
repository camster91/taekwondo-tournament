/**
 * Where clause (on DivisionAssignment) for "this registration already
 * sits in a division of this event type". POST /api/divisions/:id/assign
 * refuses such a registration (409), and the BracketEditor picker
 * (GET /api/tournaments/:id/registrations?notInDivision=) hides exactly
 * those, so the picker never offers someone the assign route rejects.
 *
 * A registration entered in both events legitimately holds one
 * assignment per event type (auto-categorization creates exactly that),
 * so only an assignment of the same event type conflicts.
 */
export function sameEventAssignmentWhere(eventType: string) {
  return { division: { eventType } };
}

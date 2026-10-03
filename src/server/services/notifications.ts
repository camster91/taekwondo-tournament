/**
 * Top-bar notifications (#17). Computed on request from data the app
 * already keeps; nothing is stored. The route loads the raw counts (scoped
 * to what the caller may see) and this pure builder turns them into a
 * short, plain-language list with a link for each item.
 *
 * "Unread" is decided by the client: it remembers when the panel was last
 * opened and counts items whose `at` is newer, so every item's `at` must
 * only move forward when something actually changed.
 */

import { staffDutyLabel } from '../../shared/constants/staff-duties.js';

export type NotificationTone = 'info' | 'warning' | 'danger';

export interface AppNotification {
  /** Stable per subject (e.g. one per tournament), used as a React key. */
  id: string;
  kind:
    | 'support_tickets'
    | 'pending_invites'
    | 'invite_email_failed'
    | 'new_registrations'
    | 'waitlist'
    | 'staffing_gaps'
    | 'my_assignment';
  title: string;
  detail: string;
  href: string;
  /** ISO time of the latest change behind this item. */
  at: string;
  tone: NotificationTone;
}

export interface TournamentCount {
  tournamentId: string;
  tournamentName: string;
  count: number;
  latestAt: Date;
}

export interface StaffingGapSummary {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: Date;
  /** Rings with at least one uncovered stretch of a required duty. */
  ringsWithGaps: number;
  ringCount: number;
  /** Latest change to the tournament's staff assignments, if any. */
  lastAssignmentChangeAt: Date | null;
}

export interface MyAssignmentSummary {
  id: string;
  tournamentId: string;
  tournamentName: string;
  duty: string;
  ringNumber: number | null;
  startTime: string;
  endTime: string;
  updatedAt: Date;
}

export interface NotificationSources {
  supportTickets?: { open: number; bugReports: number; latestAt: Date | null };
  pendingInvites?: { count: number; latestAt: Date | null };
  failedInviteEmails?: { count: number; latestAt: Date | null };
  newRegistrations?: TournamentCount[];
  waitlisted?: TournamentCount[];
  staffingGaps?: StaffingGapSummary[];
  myAssignments?: MyAssignmentSummary[];
}

/** Longest list the panel shows; the newest items win. */
export const MAX_NOTIFICATIONS = 20;

/** Staffing warnings start this long before the tournament day. */
export const STAFFING_WARNING_LEAD_MS = 48 * 60 * 60 * 1000;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function later(a: Date, b: Date | null): Date {
  return b && b.getTime() > a.getTime() ? b : a;
}

export function buildNotifications(sources: NotificationSources): AppNotification[] {
  const items: AppNotification[] = [];

  for (const a of sources.myAssignments ?? []) {
    const where = a.ringNumber === null ? 'whole venue' : `Ring ${a.ringNumber}`;
    items.push({
      id: `my-assignment:${a.id}`,
      kind: 'my_assignment',
      title: `Your job: ${staffDutyLabel(a.duty)}, ${where}`,
      detail: `${a.startTime}–${a.endTime} · ${a.tournamentName}`,
      href: '/my-assignments',
      at: a.updatedAt.toISOString(),
      tone: 'info',
    });
  }

  for (const gap of sources.staffingGaps ?? []) {
    if (gap.ringsWithGaps <= 0) continue;
    // A gap becomes worth flagging two days out; a later assignment change
    // re-raises it so the director sees it is still not fully covered.
    const relevantFrom = new Date(gap.tournamentDate.getTime() - STAFFING_WARNING_LEAD_MS);
    items.push({
      id: `staffing:${gap.tournamentId}`,
      kind: 'staffing_gaps',
      title: gap.ringCount > 1
        ? `${gap.ringsWithGaps} of ${gap.ringCount} rings need a scorekeeper`
        : 'The ring needs a scorekeeper',
      detail: `${gap.tournamentName} · not covered for the whole day`,
      href: `/tournaments/${gap.tournamentId}/staffing`,
      at: later(relevantFrom, gap.lastAssignmentChangeAt).toISOString(),
      tone: 'warning',
    });
  }

  for (const reg of sources.newRegistrations ?? []) {
    if (reg.count <= 0) continue;
    items.push({
      id: `registrations:${reg.tournamentId}`,
      kind: 'new_registrations',
      title: `${plural(reg.count, 'new registration', 'new registrations')}`,
      detail: `${reg.tournamentName} · last 24 hours`,
      href: `/tournaments/${reg.tournamentId}`,
      at: reg.latestAt.toISOString(),
      tone: 'info',
    });
  }

  for (const wait of sources.waitlisted ?? []) {
    if (wait.count <= 0) continue;
    items.push({
      id: `waitlist:${wait.tournamentId}`,
      kind: 'waitlist',
      title: `${plural(wait.count, 'person is', 'people are')} on the waitlist`,
      detail: wait.tournamentName,
      href: `/waitlist/${wait.tournamentId}`,
      at: wait.latestAt.toISOString(),
      tone: 'info',
    });
  }

  const tickets = sources.supportTickets;
  if (tickets && tickets.open > 0 && tickets.latestAt) {
    items.push({
      id: 'support-tickets',
      kind: 'support_tickets',
      title: `${plural(tickets.open, 'open support request', 'open support requests')}`,
      detail: tickets.bugReports > 0
        ? `${plural(tickets.bugReports, 'is a bug report', 'are bug reports')}`
        : 'Nothing marked as a bug yet',
      href: '/support/tickets',
      at: tickets.latestAt.toISOString(),
      tone: tickets.bugReports > 0 ? 'warning' : 'info',
    });
  }

  const failed = sources.failedInviteEmails;
  if (failed && failed.count > 0 && failed.latestAt) {
    items.push({
      id: 'invite-email-failed',
      kind: 'invite_email_failed',
      title: `${plural(failed.count, 'invite email', 'invite emails')} could not be sent`,
      detail: 'Open Users to check the address and send again',
      href: '/admin/users',
      at: failed.latestAt.toISOString(),
      tone: 'danger',
    });
  }

  const invites = sources.pendingInvites;
  if (invites && invites.count > 0 && invites.latestAt) {
    items.push({
      id: 'pending-invites',
      kind: 'pending_invites',
      title: `${plural(invites.count, 'invite is', 'invites are')} waiting to be accepted`,
      detail: 'Staff you invited have not signed in yet',
      href: '/admin/users',
      at: invites.latestAt.toISOString(),
      tone: 'info',
    });
  }

  return items
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_NOTIFICATIONS);
}

import { describe, expect, it } from 'vitest';
import { buildNotifications, MAX_NOTIFICATIONS, STAFFING_WARNING_LEAD_MS } from './notifications';

const at = (iso: string) => new Date(iso);

describe('buildNotifications', () => {
  it('returns nothing when there is nothing to report', () => {
    expect(buildNotifications({})).toEqual([]);
    expect(buildNotifications({
      supportTickets: { open: 0, bugReports: 0, latestAt: null },
      pendingInvites: { count: 0, latestAt: null },
      failedInviteEmails: { count: 0, latestAt: null },
      newRegistrations: [],
      waitlisted: [],
      staffingGaps: [{
        tournamentId: 't1', tournamentName: 'Open', tournamentDate: at('2026-10-04T00:00:00Z'),
        ringsWithGaps: 0, ringCount: 2, lastAssignmentChangeAt: null,
      }],
    })).toEqual([]);
  });

  it('writes plain, correctly pluralised titles with links', () => {
    const items = buildNotifications({
      newRegistrations: [
        { tournamentId: 't1', tournamentName: 'Spring Open', count: 1, latestAt: at('2026-10-03T10:00:00Z') },
        { tournamentId: 't2', tournamentName: 'Fall Cup', count: 3, latestAt: at('2026-10-03T09:00:00Z') },
      ],
      waitlisted: [{ tournamentId: 't1', tournamentName: 'Spring Open', count: 2, latestAt: at('2026-10-02T09:00:00Z') }],
      supportTickets: { open: 4, bugReports: 1, latestAt: at('2026-10-01T09:00:00Z') },
      pendingInvites: { count: 1, latestAt: at('2026-09-30T09:00:00Z') },
      failedInviteEmails: { count: 2, latestAt: at('2026-09-29T09:00:00Z') },
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['registrations:t1']).toMatchObject({ title: '1 new registration', href: '/tournaments/t1', tone: 'info' });
    expect(byId['registrations:t2'].title).toBe('3 new registrations');
    expect(byId['registrations:t2'].detail).toBe('Fall Cup · last 24 hours');
    expect(byId['waitlist:t1']).toMatchObject({ title: '2 people are on the waitlist', href: '/waitlist/t1' });
    expect(byId['support-tickets']).toMatchObject({
      title: '4 open support requests', detail: '1 is a bug report', href: '/support/tickets', tone: 'warning',
    });
    expect(byId['pending-invites'].title).toBe('1 invite is waiting to be accepted');
    expect(byId['invite-email-failed']).toMatchObject({ title: '2 invite emails could not be sent', tone: 'danger', href: '/admin/users' });
  });

  it('sorts newest first and caps the list', () => {
    const many = Array.from({ length: MAX_NOTIFICATIONS + 5 }, (_, i) => ({
      tournamentId: `t${i}`,
      tournamentName: `T${i}`,
      count: 1,
      latestAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
    }));
    const items = buildNotifications({ newRegistrations: many });
    expect(items).toHaveLength(MAX_NOTIFICATIONS);
    expect(items[0].id).toBe(`registrations:t${many.length - 1}`);
    const times = items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('dates a staffing gap from two days before the event, or the latest assignment change', () => {
    const tournamentDate = at('2026-10-05T00:00:00Z');
    const base = {
      tournamentId: 't1', tournamentName: 'Spring Open', tournamentDate, ringsWithGaps: 2, ringCount: 3,
    };
    const [early] = buildNotifications({ staffingGaps: [{ ...base, lastAssignmentChangeAt: at('2026-09-01T00:00:00Z') }] });
    expect(early).toMatchObject({
      kind: 'staffing_gaps',
      title: '2 of 3 rings need a scorekeeper',
      href: '/tournaments/t1/staffing',
      tone: 'warning',
      at: new Date(tournamentDate.getTime() - STAFFING_WARNING_LEAD_MS).toISOString(),
    });
    const [changed] = buildNotifications({ staffingGaps: [{ ...base, lastAssignmentChangeAt: at('2026-10-04T08:00:00Z') }] });
    expect(changed.at).toBe('2026-10-04T08:00:00.000Z');
    const [single] = buildNotifications({ staffingGaps: [{ ...base, ringsWithGaps: 1, ringCount: 1, lastAssignmentChangeAt: null }] });
    expect(single.title).toBe('The ring needs a scorekeeper');
  });

  it('describes your own job with the duty label and ring', () => {
    const [ring, venue] = buildNotifications({
      myAssignments: [
        { id: 'a1', tournamentId: 't1', tournamentName: 'Spring Open', duty: 'scorekeeper', ringNumber: 2, startTime: '09:00', endTime: '12:00', updatedAt: at('2026-10-03T08:00:00Z') },
        { id: 'a2', tournamentId: 't1', tournamentName: 'Spring Open', duty: 'check_in', ringNumber: null, startTime: '08:00', endTime: '10:00', updatedAt: at('2026-10-02T08:00:00Z') },
      ],
    });
    expect(ring).toMatchObject({ title: 'Your job: Scorekeeper, Ring 2', detail: '09:00–12:00 · Spring Open', href: '/my-assignments' });
    expect(venue.title).toBe('Your job: Check-in lead, whole venue');
  });
});

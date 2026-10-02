// Pure helpers for the family portal (routes/family-portal.ts).
import type { Prisma } from '@prisma/client';

/** Emailed family links work for 2 hours. */
export const FAMILY_LINK_TTL_MS = 2 * 60 * 60 * 1000;

export function normalizeFamilyEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Registrations made with this parent email in live tournaments. */
export function familyRegistrationWhere(email: string): Prisma.RegistrationWhereInput {
  return {
    parentEmail: { equals: email, mode: 'insensitive' },
    tournament: { deletedAt: null },
    competitor: { deletedAt: null },
  };
}

export type FamilyRegistrationStatus = 'registered' | 'waitlisted' | 'withdrawn' | 'checked_in';

export function registrationStatusFor(reg: { checkedIn: boolean; waitlistStatus: string | null }): FamilyRegistrationStatus {
  if (reg.checkedIn) return 'checked_in';
  if (reg.waitlistStatus === 'waitlisted') return 'waitlisted';
  if (reg.waitlistStatus === 'withdrawn') return 'withdrawn';
  return 'registered';
}

interface MatchLike {
  matchNumber: number;
  status: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  ringNumber: number | null;
  scheduledTime: Date | null;
}

/** The registration's next unfinished match (ring and time), if any. */
export function nextMatchFor(
  registrationId: string,
  matches: MatchLike[],
): { ringNumber: number | null; scheduledTime: Date | null } | null {
  const upcoming = matches
    .filter((m) => m.status !== 'completed' && (m.competitor1Id === registrationId || m.competitor2Id === registrationId))
    .sort((a, b) => {
      const at = a.scheduledTime?.getTime() ?? Infinity;
      const bt = b.scheduledTime?.getTime() ?? Infinity;
      return at - bt || a.matchNumber - b.matchNumber;
    });
  const next = upcoming[0];
  return next ? { ringNumber: next.ringNumber, scheduledTime: next.scheduledTime } : null;
}

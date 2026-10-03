import type { Prisma, PrismaClient } from '@prisma/client';
import { promotedRegistrationPaymentData } from './public-registration.js';
import { effectiveBrandColor } from './organizer-branding.js';
import {
  generateManagementToken,
  getManagementTokenExpiry,
  hashManagementToken,
} from '../utils/registration-management-token.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Registration statuses that occupy a capacity slot. */
export const CAPACITY_HOLDING_STATUSES = ['active', 'promoted'] as const;

/**
 * Thrown when a tournament has a hard capacity limit, is full, and has no
 * waitlist. Routes translate this into a 409.
 */
export class TournamentFullError extends Error {
  readonly status = 409;
  readonly code = 'TOURNAMENT_FULL';
  constructor(message = 'This tournament is full and is not accepting more registrations.') {
    super(message);
    this.name = 'TournamentFullError';
  }
}

export type SlotDecision =
  | { kind: 'active' }
  | { kind: 'waitlisted'; position: number }
  | { kind: 'full' };

/**
 * Pure capacity decision. `maxCapacity` null/0 means unlimited. When the
 * tournament is at capacity the registration is waitlisted if the waitlist is
 * enabled, otherwise it is rejected (`full`) — a capacity limit without a
 * waitlist is still a limit.
 */
export function decideRegistrationSlot(input: {
  maxCapacity: number | null;
  waitlistEnabled: boolean;
  activeCount: number;
  maxWaitlistPosition: number | null;
}): SlotDecision {
  const { maxCapacity, waitlistEnabled, activeCount, maxWaitlistPosition } = input;
  if (!maxCapacity || maxCapacity <= 0) return { kind: 'active' };
  if (activeCount < maxCapacity) return { kind: 'active' };
  if (!waitlistEnabled) return { kind: 'full' };
  return { kind: 'waitlisted', position: (maxWaitlistPosition ?? 0) + 1 };
}

async function countCapacityHolders(db: Db, tournamentId: string): Promise<number> {
  return db.registration.count({
    where: { tournamentId, waitlistStatus: { in: [...CAPACITY_HOLDING_STATUSES] } },
  });
}

async function maxWaitlistPosition(db: Db, tournamentId: string): Promise<number | null> {
  const row = await db.registration.findFirst({
    where: { tournamentId, waitlistStatus: 'waitlisted' },
    orderBy: { waitlistPosition: 'desc' },
    select: { waitlistPosition: true },
  });
  return row?.waitlistPosition ?? null;
}

/**
 * Advisory (unlocked) capacity check. Useful for display; registration
 * writes must use {@link reserveRegistrationSlot} inside a transaction so
 * concurrent submissions cannot overbook.
 */
export async function checkWaitlistStatus(
  prisma: Db,
  tournamentId: string,
): Promise<{ shouldWaitlist: boolean; position: number | null; isFull: boolean }> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      maxCapacity: true,
      waitlistEnabled: true,
    },
  });

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  if (!tournament.maxCapacity) {
    return { shouldWaitlist: false, position: null, isFull: false };
  }

  const activeCount = await countCapacityHolders(prisma, tournamentId);
  const decision = decideRegistrationSlot({
    maxCapacity: tournament.maxCapacity,
    waitlistEnabled: tournament.waitlistEnabled,
    activeCount,
    maxWaitlistPosition: activeCount >= tournament.maxCapacity && tournament.waitlistEnabled
      ? await maxWaitlistPosition(prisma, tournamentId)
      : null,
  });

  if (decision.kind === 'waitlisted') {
    return { shouldWaitlist: true, position: decision.position, isFull: true };
  }
  return { shouldWaitlist: false, position: null, isFull: decision.kind === 'full' };
}

/**
 * Lock the tournament row for the remainder of the transaction. Every
 * capacity-sensitive write (register, withdraw-promotion) takes this lock
 * first, so count-then-insert sequences are serialized per tournament.
 */
export async function lockTournamentForCapacity(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<{ id: string; maxCapacity: number | null; waitlistEnabled: boolean } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; maxCapacity: number | null; waitlistEnabled: boolean }>>`
    SELECT "id", "maxCapacity", "waitlistEnabled"
    FROM "Tournament"
    WHERE "id" = ${tournamentId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Decide the waitlist status for a new registration. MUST be called inside a
 * transaction after {@link lockTournamentForCapacity}; the caller inserts the
 * registration in the same transaction.
 *
 * @throws TournamentFullError when at capacity and the waitlist is disabled.
 */
export async function reserveRegistrationSlot(
  tx: Prisma.TransactionClient,
  tournament: { id: string; maxCapacity: number | null; waitlistEnabled: boolean },
): Promise<{ waitlistStatus: 'active' | 'waitlisted'; waitlistPosition: number | null }> {
  if (!tournament.maxCapacity || tournament.maxCapacity <= 0) {
    return { waitlistStatus: 'active', waitlistPosition: null };
  }
  const activeCount = await countCapacityHolders(tx, tournament.id);
  const atCapacity = activeCount >= tournament.maxCapacity;
  const decision = decideRegistrationSlot({
    maxCapacity: tournament.maxCapacity,
    waitlistEnabled: tournament.waitlistEnabled,
    activeCount,
    maxWaitlistPosition: atCapacity && tournament.waitlistEnabled
      ? await maxWaitlistPosition(tx, tournament.id)
      : null,
  });
  if (decision.kind === 'full') throw new TournamentFullError();
  if (decision.kind === 'waitlisted') {
    return { waitlistStatus: 'waitlisted', waitlistPosition: decision.position };
  }
  return { waitlistStatus: 'active', waitlistPosition: null };
}

/**
 * Renumber waitlisted registrations to a dense 1..N sequence preserving
 * their current order. Runs inside the caller's transaction.
 */
export async function renumberWaitlist(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<void> {
  const waitlisted = await tx.registration.findMany({
    where: { tournamentId, waitlistStatus: 'waitlisted' },
    orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, waitlistPosition: true },
  });
  for (let i = 0; i < waitlisted.length; i++) {
    const position = i + 1;
    if (waitlisted[i].waitlistPosition !== position) {
      await tx.registration.update({
        where: { id: waitlisted[i].id },
        data: { waitlistPosition: position },
      });
    }
  }
}

/** What the caller needs to email a family whose entry was auto-promoted. */
export interface WaitlistPromotionNotice {
  registrationId: string;
  /** Raw management token; never persisted, only emailed. */
  managementToken: string;
  parentEmail: string | null;
  competitorName: string;
  tournamentName: string;
  tournamentDate: Date;
  organizerBrandName: string | null;
  brandPrimaryColor: string | null;
  brandLogoUrl: string | null;
  /** Entry fee now due (cents), or null when nothing is owed. */
  paymentDueCents: number | null;
}

/**
 * Promote the lowest-positioned waitlisted registration if a capacity slot is
 * free, then renumber the remaining waitlist. Runs in its own transaction
 * holding the tournament row lock so it cannot race new registrations.
 *
 * The promoted registration's management token is rotated in the same
 * update (only its digest is stored), exactly like a director's manual
 * promotion, so the family can be emailed a working management link.
 *
 * Returns the promoted registration id, or null when nothing was promoted
 * (no waitlist, or still at capacity), plus what the caller needs to send
 * the promotion email after the transaction commits.
 */
export async function promoteNextWaitlisted(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<{ promotedRegistrationId: string | null; promotion: WaitlistPromotionNotice | null }> {
  return prisma.$transaction(async (tx) => {
    const tournament = await lockTournamentForCapacity(tx, tournamentId);
    if (!tournament) return { promotedRegistrationId: null, promotion: null };

    let promotedRegistrationId: string | null = null;
    let promotion: WaitlistPromotionNotice | null = null;
    const activeCount = await countCapacityHolders(tx, tournamentId);
    const hasFreeSlot = !tournament.maxCapacity || activeCount < tournament.maxCapacity;

    if (hasFreeSlot) {
      const next = await tx.registration.findFirst({
        where: { tournamentId, waitlistStatus: 'waitlisted' },
        orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          paymentStatus: true,
          paymentAmountCents: true,
          parentEmail: true,
          competitor: { select: { firstName: true, lastName: true } },
          tournament: {
            select: {
              settings: true,
              name: true,
              date: true,
              brandName: true,
              brandPrimaryColor: true,
              brandLogoUrl: true,
              organization: { select: { brandName: true, brandPrimaryColor: true, brandLogoUrl: true } },
            },
          },
        },
      });
      if (next) {
        // The entry fee becomes due now that the registrant holds a spot.
        const payment = promotedRegistrationPaymentData(next.tournament.settings, next.paymentStatus);
        const managementToken = generateManagementToken();
        await tx.registration.update({
          where: { id: next.id },
          data: {
            waitlistStatus: 'promoted',
            waitlistPosition: null,
            waitlistPromotedAt: new Date(),
            managementTokenHash: hashManagementToken(managementToken),
            managementTokenExpiresAt: getManagementTokenExpiry(),
            managementTokenRevokedAt: null,
            ...payment,
          },
        });
        promotedRegistrationId = next.id;
        promotion = {
          registrationId: next.id,
          managementToken,
          parentEmail: next.parentEmail,
          competitorName: `${next.competitor.firstName} ${next.competitor.lastName}`,
          tournamentName: next.tournament.name,
          tournamentDate: next.tournament.date,
          organizerBrandName: next.tournament.brandName || next.tournament.organization?.brandName || null,
          brandPrimaryColor: effectiveBrandColor(next.tournament.brandPrimaryColor, next.tournament.organization?.brandPrimaryColor),
          brandLogoUrl: next.tournament.brandLogoUrl || next.tournament.organization?.brandLogoUrl || null,
          paymentDueCents: 'paymentAmountCents' in payment
            ? payment.paymentAmountCents
            : next.paymentStatus === 'pending' || next.paymentStatus === 'failed'
              ? next.paymentAmountCents
              : null,
        };
      }
    }

    await renumberWaitlist(tx, tournamentId);
    return { promotedRegistrationId, promotion };
  });
}

export type ManualPromotionResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; code: 'NOT_FOUND' | 'NOT_WAITLISTED' }
  | { ok: false; status: 400; code: 'TOURNAMENT_FULL'; activeCount: number; maxCapacity: number };

/**
 * Director-initiated promotion of one specific waitlisted registration.
 * Runs in its own transaction holding the tournament row lock (the same lock
 * public registration takes), and re-reads both the registration and the
 * capacity count under it — so concurrent promotes cannot overfill the
 * tournament, and a double-click cannot promote twice (the second sees
 * NOT_WAITLISTED, and its management token never replaces the first's).
 *
 * `onPromoted` runs inside the transaction after the update (audit logging).
 */
export async function promoteWaitlistedRegistration(
  prisma: PrismaClient,
  tournamentId: string,
  registrationId: string,
  data: {
    managementTokenHash: string;
    managementTokenExpiresAt: Date;
    payment?: ReturnType<typeof promotedRegistrationPaymentData>;
  },
  onPromoted?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<ManualPromotionResult> {
  return prisma.$transaction(async (tx) => {
    const tournament = await lockTournamentForCapacity(tx, tournamentId);
    if (!tournament) return { ok: false, status: 404, code: 'NOT_FOUND' } as const;

    const current = await tx.registration.findUnique({
      where: { id: registrationId },
      select: { tournamentId: true, waitlistStatus: true },
    });
    if (!current || current.tournamentId !== tournamentId) {
      return { ok: false, status: 404, code: 'NOT_FOUND' } as const;
    }
    if (current.waitlistStatus !== 'waitlisted') {
      return { ok: false, status: 409, code: 'NOT_WAITLISTED' } as const;
    }

    if (tournament.maxCapacity && tournament.maxCapacity > 0) {
      const activeCount = await countCapacityHolders(tx, tournamentId);
      if (activeCount >= tournament.maxCapacity) {
        return { ok: false, status: 400, code: 'TOURNAMENT_FULL', activeCount, maxCapacity: tournament.maxCapacity } as const;
      }
    }

    await tx.registration.update({
      where: { id: registrationId },
      data: {
        waitlistStatus: 'promoted',
        waitlistPromotedAt: new Date(),
        waitlistPosition: null,
        managementTokenHash: data.managementTokenHash,
        managementTokenExpiresAt: data.managementTokenExpiresAt,
        managementTokenRevokedAt: null,
        ...data.payment,
      },
    });
    await renumberWaitlist(tx, tournamentId);
    if (onPromoted) await onPromoted(tx);
    return { ok: true } as const;
  });
}

/**
 * Get capacity status for a tournament (for display in organizer UI and public pages).
 */
export async function getTournamentCapacityStatus(
  prisma: PrismaClient,
  tournamentId: string,
) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      maxCapacity: true,
      waitlistEnabled: true,
    },
  });

  if (!tournament) {
    return null;
  }

  const [activeCount, waitlistCount] = await Promise.all([
    prisma.registration.count({
      where: {
        tournamentId,
        waitlistStatus: { in: ['active', 'promoted'] },
      },
    }),
    prisma.registration.count({
      where: {
        tournamentId,
        waitlistStatus: 'waitlisted',
      },
    }),
  ]);

  const hasCapacityLimit = tournament.maxCapacity != null && tournament.maxCapacity > 0;
  const spotsRemaining = hasCapacityLimit && tournament.maxCapacity != null
    ? Math.max(0, tournament.maxCapacity - activeCount)
    : null;
  const isFull = hasCapacityLimit && spotsRemaining === 0;

  return {
    maxCapacity: tournament.maxCapacity,
    waitlistEnabled: tournament.waitlistEnabled,
    activeCount,
    waitlistCount,
    spotsRemaining,
    isFull,
  };
}

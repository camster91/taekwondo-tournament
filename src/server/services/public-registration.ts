/**
 * Shared write path for anonymous (public / portal) registrations.
 *
 * Invariants enforced here:
 * - Capacity + plan limits are checked and the registration inserted inside
 *   one transaction that holds the tournament row lock, so concurrent
 *   submissions can neither overbook nor duplicate a waitlist position.
 * - An anonymous registrant may only be linked to a pre-existing Competitor
 *   from the same tenant (same organization; or, for org-less tournaments,
 *   a competitor that only appears in org-less tournaments). Otherwise a new
 *   Competitor row is created. Pre-existing competitor rows are never
 *   modified by this path.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { canAddRegistration, getPlanEntitlements } from './entitlements.js';
import { lockTournamentForCapacity, reserveRegistrationSlot, TournamentFullError } from './waitlist.js';
import {
  generateManagementToken,
  getManagementTokenExpiry,
  hashManagementToken,
} from '../utils/registration-management-token.js';

type Db = PrismaClient | Prisma.TransactionClient;

export class AlreadyRegisteredError extends Error {
  readonly status = 409;
  constructor() {
    super('Already registered');
    this.name = 'AlreadyRegisteredError';
  }
}

export class RegistrationLimitError extends Error {
  readonly status = 400;
  constructor(readonly limit: number) {
    super(`registration limit of ${limit} reached`);
    this.name = 'RegistrationLimitError';
  }
}

export class TournamentNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super('Tournament not found');
    this.name = 'TournamentNotFoundError';
  }
}

/**
 * Tenant scope for re-using an existing Competitor on anonymous
 * registration. Competitors are global rows; tenancy is derived from the
 * tournaments they are registered in (same model as competitors.ts).
 */
export function competitorReuseScope(organizationId: string | null): Prisma.CompetitorWhereInput {
  if (organizationId) {
    return {
      registrations: {
        some: { tournament: { organizationId } },
        every: { tournament: { organizationId } },
      },
    };
  }
  return {
    registrations: { every: { tournament: { organizationId: null } } },
  };
}

export interface PublicCompetitorInput {
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: Date;
  belt: string;
  danRank: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
  specialNeeds: string | null;
}

export type PublicRegistrationData = Omit<
  Prisma.RegistrationUncheckedCreateInput,
  | 'tournamentId'
  | 'competitorId'
  | 'managementTokenHash'
  | 'managementTokenExpiresAt'
  | 'waitlistStatus'
  | 'waitlistPosition'
>;

export interface CreatePublicRegistrationInput {
  tournamentId: string;
  organizationId: string | null;
  plan: string;
  competitor: PublicCompetitorInput;
  registration: PublicRegistrationData;
}

export interface CreatePublicRegistrationResult {
  managementToken: string;
  competitor: { id: string; firstName: string; lastName: string };
  registration: {
    id: string;
    tournamentId: string;
    patterns: boolean;
    sparring: boolean;
    waitlistStatus: string | null;
    waitlistPosition: number | null;
    paymentStatus: string | null;
    paymentAmountCents: number | null;
  };
}

export async function createPublicRegistration(
  prisma: PrismaClient,
  input: CreatePublicRegistrationInput,
): Promise<CreatePublicRegistrationResult> {
  const managementToken = generateManagementToken();

  return prisma.$transaction(async (tx) => {
    const tournament = await lockTournamentForCapacity(tx, input.tournamentId);
    if (!tournament) throw new TournamentNotFoundError();

    // Plan limit is checked under the same lock as the insert.
    const existingCount = await tx.registration.count({
      where: { tournamentId: input.tournamentId, NOT: { waitlistStatus: 'withdrawn' } },
    });
    if (!canAddRegistration(input.plan, existingCount)) {
      throw new RegistrationLimitError(getPlanEntitlements(input.plan).maxCompetitorsPerTournament);
    }

    const c = input.competitor;
    let competitor = await tx.competitor.findFirst({
      where: {
        firstName: { equals: c.firstName, mode: 'insensitive' },
        lastName: { equals: c.lastName, mode: 'insensitive' },
        dateOfBirth: c.dateOfBirth,
        deletedAt: null,
        ...competitorReuseScope(input.organizationId),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    });

    if (competitor) {
      const existingRegistration = await tx.registration.findUnique({
        where: {
          tournamentId_competitorId: {
            tournamentId: input.tournamentId,
            competitorId: competitor.id,
          },
        },
        select: { id: true },
      });
      if (existingRegistration) throw new AlreadyRegisteredError();
    } else {
      competitor = await tx.competitor.create({
        data: c,
        select: { id: true, firstName: true, lastName: true },
      });
    }

    const slot = await reserveRegistrationSlot(tx, tournament);

    const registration = await tx.registration.create({
      data: {
        ...input.registration,
        tournamentId: input.tournamentId,
        competitorId: competitor.id,
        managementTokenHash: hashManagementToken(managementToken),
        managementTokenExpiresAt: getManagementTokenExpiry(),
        waitlistStatus: slot.waitlistStatus,
        waitlistPosition: slot.waitlistPosition,
      },
      select: {
        id: true,
        tournamentId: true,
        patterns: true,
        sparring: true,
        waitlistStatus: true,
        waitlistPosition: true,
        paymentStatus: true,
        paymentAmountCents: true,
      },
    });

    return { managementToken, competitor, registration };
  });
}

/**
 * Map the typed errors thrown by {@link createPublicRegistration} to an HTTP
 * response. Returns null for unexpected errors (caller rethrows).
 */
export function publicRegistrationErrorResponse(
  error: unknown,
  competitorName: string,
  noun: 'tournament' | 'event',
): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof AlreadyRegisteredError) {
    return {
      status: 409,
      body: { error: 'Already registered', message: `${competitorName} is already registered for this ${noun}` },
    };
  }
  if (error instanceof RegistrationLimitError) {
    return {
      status: 400,
      body: { error: `This ${noun} has reached its registration limit of ${error.limit} competitors.` },
    };
  }
  if (error instanceof TournamentFullError) {
    return {
      status: 409,
      body: { error: `This ${noun} is full and is not accepting more registrations.`, code: error.code },
    };
  }
  if (error instanceof TournamentNotFoundError) {
    return { status: 404, body: { error: noun === 'event' ? 'Event not found' : 'Tournament not found' } };
  }
  return null;
}

/** Window in which a competitor row counts as created by a registration. */
const OWNERSHIP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether the competitor behind `registration` was created by that anonymous
 * registration and is not used anywhere else — only then may the holder of
 * the registration's management token edit competitor-level fields.
 *
 * Without a creator column this is inferred: the competitor has exactly this
 * one registration, no competition history, and was created alongside it.
 */
export async function isCompetitorOwnedByRegistration(
  db: Db,
  registration: { id: string; competitorId: string; createdAt: Date },
): Promise<boolean> {
  const competitor = await db.competitor.findUnique({
    where: { id: registration.competitorId },
    select: {
      createdAt: true,
      deletedAt: true,
      _count: { select: { registrations: true, competitorHistory: true } },
    },
  });
  if (!competitor || competitor.deletedAt) return false;
  if (competitor._count.registrations !== 1 || competitor._count.competitorHistory !== 0) return false;
  const delta = registration.createdAt.getTime() - competitor.createdAt.getTime();
  return Math.abs(delta) <= OWNERSHIP_WINDOW_MS;
}

/** Payment states from which a parent may (re)start an entry-fee checkout. */
export const CHECKOUT_ALLOWED_PAYMENT_STATUSES = ['pending', 'failed'] as const;

export function parseTournamentFeeCents(settings: string | null): number {
  if (!settings) return 0;
  try {
    const parsed = JSON.parse(settings) as Record<string, unknown>;
    const fee = parsed.tournamentFeeCents;
    return typeof fee === 'number' && Number.isInteger(fee) && fee > 0 ? fee : 0;
  } catch {
    return 0;
  }
}

/**
 * Build Stripe Checkout line items for an entry fee. Deliberately contains
 * only the tournament name — never the (usually minor) competitor's name,
 * which would otherwise be stored at Stripe and printed on receipts.
 */
export function entryFeeLineItems(tournamentName: string, amountCents: number) {
  return [
    {
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: {
          name: `Entry Fee: ${tournamentName}`,
          description: 'Tournament registration entry fee',
        },
      },
      quantity: 1,
    },
  ];
}

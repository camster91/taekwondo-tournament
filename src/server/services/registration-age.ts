import type { Prisma, PrismaClient } from '@prisma/client';
import { calculateAge } from '../../shared/constants/age-groups.js';

type RegistrationAgeClient = Pick<PrismaClient | Prisma.TransactionClient, 'registration'>;

/**
 * Recompute `Registration.ageAtTournament` for every registration that
 * matches `where` (all of one tournament's, or all of one competitor's).
 *
 * The age is stored at registration time and drives categorization, so
 * it must be refreshed whenever an input changes: the tournament date or
 * the competitor's date of birth. Uses the same `calculateAge` as the
 * registration create paths. Only rows whose stored age actually differs
 * are written. Returns the number of registrations updated.
 *
 * Pass the transaction client when the caller has one so the age change
 * commits (or rolls back) with the date/DOB change that caused it.
 */
export async function recomputeRegistrationAges(
  client: RegistrationAgeClient,
  where: { tournamentId: string } | { competitorId: string },
): Promise<number> {
  const registrations = await client.registration.findMany({
    where,
    select: {
      id: true,
      ageAtTournament: true,
      competitor: { select: { dateOfBirth: true } },
      tournament: { select: { date: true } },
    },
  });

  let updated = 0;
  for (const registration of registrations) {
    const age = calculateAge(registration.competitor.dateOfBirth, registration.tournament.date);
    if (age === registration.ageAtTournament) continue;
    await client.registration.update({
      where: { id: registration.id },
      data: { ageAtTournament: age },
    });
    updated += 1;
  }
  return updated;
}

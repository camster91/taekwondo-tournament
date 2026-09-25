/**
 * Competitor Deduplication Service
 * 
 * Fuzzy matching on name + date of birth to detect potential duplicates
 * in the competitor registry. Supports merging competitors while preserving
 * tournament history.
 */

import { Prisma, PrismaClient, Competitor } from '@prisma/client';

/**
 * Calculate Levenshtein distance between two strings
 * (character edit distance)
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
function stringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Normalize a name for comparison (lowercase, trim, remove extra spaces)
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Calculate overall match score between two competitors
 * Returns a score between 0 and 1, where 1 is a perfect match
 */
export interface MatchScore {
  overallScore: number;
  nameScore: number;
  dobMatch: boolean;
  details: {
    firstNameSimilarity: number;
    lastNameSimilarity: number;
    dobDaysDiff: number;
  };
}

export function calculateMatchScore(
  c1: Pick<Competitor, 'firstName' | 'lastName' | 'dateOfBirth'>,
  c2: Pick<Competitor, 'firstName' | 'lastName' | 'dateOfBirth'>
): MatchScore {
  // Normalize names
  const fn1 = normalizeName(c1.firstName);
  const fn2 = normalizeName(c2.firstName);
  const ln1 = normalizeName(c1.lastName);
  const ln2 = normalizeName(c2.lastName);

  // Calculate name similarities
  const firstNameSimilarity = stringSimilarity(fn1, fn2);
  const lastNameSimilarity = stringSimilarity(ln1, ln2);
  const nameScore = (firstNameSimilarity + lastNameSimilarity) / 2;

  // Calculate date of birth difference in days
  const dob1 = new Date(c1.dateOfBirth).getTime();
  const dob2 = new Date(c2.dateOfBirth).getTime();
  const dobDaysDiff = Math.abs(dob1 - dob2) / (1000 * 60 * 60 * 24);
  const dobMatch = dobDaysDiff === 0;

  // Overall score: heavily weight exact DOB match, then name similarity
  // - If DOB matches exactly and names are similar (>0.7), very high score
  // - If DOB is close (within 1 day, possible typo) and names match well, medium-high score
  // - Otherwise, low score
  let overallScore: number;
  if (dobMatch) {
    overallScore = 0.3 + (nameScore * 0.7); // DOB match is 30% base + 70% from name
  } else if (dobDaysDiff <= 1 && nameScore > 0.8) {
    overallScore = 0.5 + (nameScore * 0.4); // Close DOB + good name match
  } else {
    overallScore = nameScore * 0.4; // No DOB match, rely on name only
  }

  return {
    overallScore,
    nameScore,
    dobMatch,
    details: {
      firstNameSimilarity,
      lastNameSimilarity,
      dobDaysDiff,
    },
  };
}

/**
 * Find potential duplicate competitors
 */
/**
 * Fields returned for each side of a duplicate pair. Deliberately
 * excludes sensitive columns (specialNeeds, region, ...) that the
 * duplicates UI doesn't render.
 */
export const DUPLICATE_COMPETITOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  belt: true,
  beltStripe: true,
  danRank: true,
  heightInches: true,
  weightLbs: true,
  schoolDojang: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { registrations: true } },
} satisfies Prisma.CompetitorSelect;

export type DuplicateCompetitor = Prisma.CompetitorGetPayload<{ select: typeof DUPLICATE_COMPETITOR_SELECT }>;

export interface PotentialDuplicate {
  competitor1: DuplicateCompetitor;
  competitor2: DuplicateCompetitor;
  matchScore: MatchScore;
}

/**
 * Lowest accepted threshold. A pair without DOBs within one day
 * scores at most 0.4 (name-only), so any threshold above 0.4 lets the
 * scan compare only competitors whose DOBs are within a day of each
 * other — sort + sliding window instead of an all-pairs O(n²) scan.
 * Lower thresholds would only flood the UI with name-only noise.
 */
export const MIN_DUPLICATE_THRESHOLD = 0.5;
/** Hard cap on how many competitors are loaded for one scan. */
export const MAX_DUPLICATE_CANDIDATES = 2000;
/** Hard cap on returned pairs. */
export const MAX_DUPLICATE_RESULTS = 200;

const DAY_MS = 1000 * 60 * 60 * 24;

export function clampDuplicateThreshold(threshold: number): number {
  if (!Number.isFinite(threshold)) return 0.75;
  return Math.min(1, Math.max(MIN_DUPLICATE_THRESHOLD, threshold));
}

export async function findPotentialDuplicates(
  prisma: PrismaClient,
  threshold = 0.75,
  options: {
    /** Tenant scoping (competitor access filter). Omit only for admins. */
    where?: Prisma.CompetitorWhereInput;
    maxCandidates?: number;
    maxResults?: number;
  } = {}
): Promise<PotentialDuplicate[]> {
  const effectiveThreshold = clampDuplicateThreshold(threshold);
  const maxCandidates = Math.min(options.maxCandidates ?? MAX_DUPLICATE_CANDIDATES, MAX_DUPLICATE_CANDIDATES);
  const maxResults = Math.min(options.maxResults ?? MAX_DUPLICATE_RESULTS, MAX_DUPLICATE_RESULTS);

  // Active (not soft-deleted) competitors the caller may see, ordered
  // by DOB so candidate pairs are adjacent.
  const competitors = await prisma.competitor.findMany({
    where: options.where ? { AND: [{ deletedAt: null }, options.where] } : { deletedAt: null },
    select: DUPLICATE_COMPETITOR_SELECT,
    orderBy: [{ dateOfBirth: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    take: maxCandidates,
  });

  const duplicates: PotentialDuplicate[] = [];

  // Sliding window: only pairs whose DOBs are within one day can reach
  // a threshold above 0.4 (see MIN_DUPLICATE_THRESHOLD).
  for (let i = 0; i < competitors.length; i++) {
    const c1 = competitors[i];
    const dob1 = new Date(c1.dateOfBirth).getTime();
    for (let j = i + 1; j < competitors.length; j++) {
      const c2 = competitors[j];
      if (new Date(c2.dateOfBirth).getTime() - dob1 > DAY_MS) break;

      const matchScore = calculateMatchScore(c1, c2);

      if (matchScore.overallScore >= effectiveThreshold) {
        duplicates.push({
          competitor1: c1,
          competitor2: c2,
          matchScore,
        });
      }
    }
  }

  // Sort by match score (highest first), then cap.
  duplicates.sort((a, b) => b.matchScore.overallScore - a.matchScore.overallScore);

  return duplicates.slice(0, maxResults);
}

/**
 * Merge two competitors, preserving history
 * 
 * The "primary" competitor is kept; the "secondary" is merged into it
 * and soft-deleted. All registrations, history, and ratings from the
 * secondary are transferred to the primary.
 */
export interface MergeResult {
  primaryId: string;
  secondaryId: string;
  mergedFields: string[];
  transferredRegistrations: number;
  transferredHistory: number;
  transferredRatings: number;
}

export async function mergeCompetitors(
  prisma: PrismaClient,
  primaryId: string,
  secondaryId: string,
  mergeOptions?: {
    takeSecondaryBelt?: boolean;
    takeSecondaryWeight?: boolean;
    takeSecondaryHeight?: boolean;
    takeSecondarySchool?: boolean;
  }
): Promise<MergeResult> {
  return await prisma.$transaction(async (tx) => {
    // Fetch both competitors
    const primary = await tx.competitor.findUnique({ where: { id: primaryId } });
    const secondary = await tx.competitor.findUnique({ where: { id: secondaryId } });

    if (!primary || !secondary) {
      throw new Error('One or both competitors not found');
    }

    if (primaryId === secondaryId) {
      throw new Error('Cannot merge a competitor with itself');
    }

    // Transfer all registrations from secondary to primary
    const registrations = await tx.registration.findMany({
      where: { competitorId: secondaryId },
    });

    // Check for duplicate registrations (same tournament)
    const primaryTournamentIds = await tx.registration.findMany({
      where: { competitorId: primaryId },
      select: { tournamentId: true },
    }).then(regs => new Set(regs.map(r => r.tournamentId)));

    let transferredCount = 0;
    for (const reg of registrations) {
      if (!primaryTournamentIds.has(reg.tournamentId)) {
        // No conflict, transfer directly
        await tx.registration.update({
          where: { id: reg.id },
          data: { competitorId: primaryId },
        });
        transferredCount++;
      } else {
        // Conflict: primary already has a registration for this tournament
        // Keep the primary's registration, soft-delete the secondary's
        await tx.registration.delete({
          where: { id: reg.id },
        });
      }
    }

    // Transfer history records
    const historyCount = await tx.competitorHistory.updateMany({
      where: { competitorId: secondaryId },
      data: { competitorId: primaryId },
    }).then(result => result.count);

    // Transfer ratings
    const ratingsCount = await tx.competitorRating.updateMany({
      where: { competitorId: secondaryId },
      data: { competitorId: primaryId },
    }).then(result => result.count);

    // Merge selected fields from secondary to primary (if requested)
    const mergedFields: string[] = [];
    const updateData: Partial<Competitor> = {};

    if (mergeOptions?.takeSecondaryBelt && secondary.belt) {
      updateData.belt = secondary.belt;
      if (secondary.beltStripe) updateData.beltStripe = secondary.beltStripe;
      if (secondary.danRank !== null) updateData.danRank = secondary.danRank;
      mergedFields.push('belt');
    }

    if (mergeOptions?.takeSecondaryWeight && secondary.weightLbs) {
      updateData.weightLbs = secondary.weightLbs;
      mergedFields.push('weight');
    }

    if (mergeOptions?.takeSecondaryHeight && secondary.heightInches) {
      updateData.heightInches = secondary.heightInches;
      mergedFields.push('height');
    }

    if (mergeOptions?.takeSecondarySchool && secondary.schoolDojang) {
      updateData.schoolDojang = secondary.schoolDojang;
      mergedFields.push('school');
    }

    // Update primary if any fields were merged
    if (Object.keys(updateData).length > 0) {
      await tx.competitor.update({
        where: { id: primaryId },
        data: updateData,
      });
    }

    // Soft-delete the secondary competitor
    await tx.competitor.update({
      where: { id: secondaryId },
      data: { deletedAt: new Date() },
    });

    return {
      primaryId,
      secondaryId,
      mergedFields,
      transferredRegistrations: transferredCount,
      transferredHistory: historyCount,
      transferredRatings: ratingsCount,
    };
  });
}

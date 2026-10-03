import type { PrismaClient } from '@prisma/client';
import { getEventTypeLabel } from '../../shared/constants/sport-profiles.js';
import {
  beltRangeLabel,
  classicHeaderTitle,
  classicZipPath,
} from '../../shared/utils/classic-paper.js';
import {
  buildClassicRounds,
  generateClassicBracketPDF,
  type ClassicSlot,
  type TournamentInfo,
} from './pdf-export.js';
import { createZip } from '../utils/zip.js';

/**
 * Loads divisions and turns each into a classic paper sheet (see
 * `generateClassicBracketPDF`). Callers must already have checked
 * tournament access.
 */

interface RegistrationWithCompetitor {
  id: string;
  competitor: {
    firstName: string;
    lastName: string;
    schoolDojang: string | null;
    danRank: number | null;
  };
}

const competitorSelect = {
  select: {
    id: true,
    competitor: { select: { firstName: true, lastName: true, schoolDojang: true, danRank: true } },
  },
} as const;

function toSlot(reg: RegistrationWithCompetitor | null | undefined): ClassicSlot | null {
  if (!reg) return null;
  return {
    id: reg.id,
    name: `${reg.competitor.firstName} ${reg.competitor.lastName}`.trim(),
    school: reg.competitor.schoolDojang,
    danRank: reg.competitor.danRank,
  };
}

export interface ClassicSheetFile {
  divisionId: string;
  /** "CB Females Sparring/<division>.pdf" */
  path: string;
  pdf: Buffer;
}

/**
 * Build classic sheets for one tournament. `divisionId` limits it to a
 * single division. Divisions in the trash are left out, as are empty
 * divisions when exporting the whole tournament.
 */
export async function buildClassicSheets(
  prisma: PrismaClient,
  tournamentId: string,
  divisionId?: string,
): Promise<ClassicSheetFile[]> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      name: true,
      date: true,
      location: true,
      brandName: true,
      sportProfileSlug: true,
      divisions: {
        where: { deletedAt: null, ...(divisionId ? { id: divisionId } : {}) },
        orderBy: [{ eventType: 'asc' }, { beltLevel: 'asc' }, { gender: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          beltLevel: true,
          gender: true,
          eventType: true,
          ageMin: true,
          ageMax: true,
          weightClass: true,
          beltColors: true,
          danMin: true,
          danMax: true,
          assignments: {
            orderBy: [{ seedPosition: 'asc' }],
            select: { registration: competitorSelect },
          },
          bracket: {
            select: {
              format: true,
              matches: {
                select: {
                  bracketType: true,
                  roundNumber: true,
                  matchNumber: true,
                  competitor1: competitorSelect,
                  competitor2: competitorSelect,
                  winner: competitorSelect,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!tournament) return [];

  const info: TournamentInfo = {
    name: tournament.name,
    date: tournament.date.toLocaleDateString(),
    location: tournament.location,
    brandName: tournament.brandName,
  };

  const taken = new Set<string>();
  const files: ClassicSheetFile[] = [];
  for (const division of tournament.divisions) {
    const entrants = division.assignments
      .map((a) => toSlot(a.registration))
      .filter((s): s is ClassicSlot => s !== null);
    if (!divisionId && entrants.length === 0 && !division.bracket) continue;

    const bracket = division.bracket
      ? {
          format: division.bracket.format,
          matches: division.bracket.matches.map((m) => ({
            bracketType: m.bracketType,
            roundNumber: m.roundNumber,
            matchNumber: m.matchNumber,
            competitor1: toSlot(m.competitor1),
            competitor2: toSlot(m.competitor2),
            winner: toSlot(m.winner),
          })),
        }
      : null;

    const eventLabel = getEventTypeLabel(tournament.sportProfileSlug, division.eventType);
    const pdf = generateClassicBracketPDF(info, {
      title: classicHeaderTitle(division, eventLabel),
      divisionName: division.name,
      beltRange: beltRangeLabel(division),
      rounds: buildClassicRounds(bracket, entrants),
    });
    files.push({
      divisionId: division.id,
      path: classicZipPath(division, eventLabel, taken),
      pdf: Buffer.from(pdf.output('arraybuffer')),
    });
  }
  return files;
}

/** Every classic sheet of a tournament in one ZIP, folders like the old event. */
export function zipClassicSheets(files: ClassicSheetFile[]): Buffer {
  return createZip(files.map((f) => ({ path: f.path, data: f.pdf })));
}

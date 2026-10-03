import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import {
  authenticate,
  buildCompetitorAccessFilter,
  requireTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import type { ColumnMapping } from '../services/excel-import.js';
import {
  MAX_HEADER_ROW,
  autoDetectMappingFromWorkbook,
  detectEventColumns,
  readUploadedWorkbook,
  resolveImportSheet,
  sheetHeaders,
  sheetRowsForImport,
} from '../services/excel-auto-map.js';
import {
  applyTournamentImport,
  missingImportColumns,
  planTournamentImport,
  prepareTournamentImportRows,
  tournamentCompetitorScope,
  TournamentImportLimitError,
  TournamentImportNotFoundError,
  type TournamentImportSummary,
} from '../services/tournament-import.js';
import { getEventTypeLabels } from '../../shared/constants/sport-profiles.js';
import { createAuditLog, getClientIp, getUserAgent } from '../services/audit-log.js';

// Import a spreadsheet straight into a tournament (roadmap #11). The same
// endpoint previews (default) and, with `commit: true`, writes. The body
// can be up to 40 MB (see LARGE_JSON_BODY_ROUTES).

const router = Router();

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const column = z.string().max(255).optional();
const MAPPING_KEYS = [
  'firstName', 'lastName', 'name', 'gender', 'dateOfBirth', 'age', 'belt', 'danRank',
  'height', 'weight', 'school', 'patterns', 'sparring', 'specialNeeds',
] as const satisfies ReadonlyArray<keyof ColumnMapping>;

export const tournamentImportSchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().max(255).optional(),
  // Sent back with a mapping, as returned by the previous preview.
  sheetName: z.string().min(1).max(255).optional(),
  headerRow: z.number().int().min(1).max(MAX_HEADER_ROW).optional(),
  // Omitted: columns are detected (event columns by the sport's names).
  columnMapping: z.object(Object.fromEntries(MAPPING_KEYS.map((k) => [k, column])) as Record<typeof MAPPING_KEYS[number], typeof column>).strict().optional(),
  commit: z.boolean().optional(),
});
type TournamentImportBody = z.infer<typeof tournamentImportSchema>;

/** Keep only mapped columns that exist on the header row. */
function cleanMapping(mapping: Partial<Record<keyof ColumnMapping, string | undefined>>, headers: string[]): Partial<ColumnMapping> {
  const known = new Set(headers);
  const out: Partial<ColumnMapping> = {};
  for (const key of MAPPING_KEYS) {
    const value = mapping[key];
    if (value && known.has(value)) out[key] = value;
  }
  return out;
}

const getParam = (param: string | string[] | undefined): string => (Array.isArray(param) ? param[0] : param || '');

router.post('/:id/import', authenticate, requireTournamentAccess('director'), validateRequest(tournamentImportSchema), async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const authReq = req as AuthenticatedRequest;
  const tournamentId = getParam(req.params.id);
  const body = req.body as TournamentImportBody;

  const buffer = Buffer.from(body.fileBase64, 'base64');
  if (buffer.length > MAX_FILE_BYTES) {
    return res.status(413).json({ error: 'This file is too big (25 MB at most). Split it into smaller files.' });
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true, name: true, date: true, organizationId: true, maxCapacity: true, waitlistEnabled: true,
      sportProfileSlug: true, organization: { select: { plan: true } },
    },
  });
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  let workbook;
  try {
    workbook = readUploadedWorkbook(buffer);
  } catch {
    return res.status(400).json({ error: 'This file could not be read. Save it as an Excel (.xlsx) or CSV file and try again.' });
  }

  // Sheet, header row and columns: what the client confirmed, or detected.
  let sheetName: string;
  let headerRow: number;
  let mapping: Partial<ColumnMapping>;
  if (body.columnMapping) {
    ({ sheetName, headerRow } = resolveImportSheet(workbook, { sheetName: body.sheetName, headerRow: body.headerRow }));
    mapping = cleanMapping(body.columnMapping, sheetHeaders(workbook, sheetName, headerRow));
  } else {
    const auto = autoDetectMappingFromWorkbook(workbook);
    if (!auto.suggestedSheet) return res.status(400).json({ error: 'This file has no sheets to import.' });
    ({ sheetName, headerRow } = resolveImportSheet(workbook, { sheetName: auto.suggestedSheet, headerRow: auto.detectedHeaderRow }));
    // Event columns are looked up by this sport's event names instead of
    // the registry import's Taekwondo-only guesses.
    const { patterns: _p, sparring: _s, ...others } = auto.mapping;
    const events = detectEventColumns(auto.rawHeaders, tournament.sportProfileSlug, Object.values(others).filter(Boolean) as string[]);
    mapping = cleanMapping({ ...others, ...events }, sheetHeaders(workbook, sheetName, headerRow));
  }

  const headers = sheetHeaders(workbook, sheetName, headerRow);
  const missing = missingImportColumns(mapping);
  const meta = {
    sheetName,
    headerRow,
    headers,
    mapping,
    missing,
    eventLabels: getEventTypeLabels(tournament.sportProfileSlug),
  };
  if (missing.length > 0) {
    if (body.commit) {
      return res.status(400).json({ error: `Some columns are missing: ${missing.join(', ')}.`, ...meta });
    }
    return res.json({ ...meta, summary: null, committed: false });
  }

  const { rows, skipped } = prepareTournamentImportRows(sheetRowsForImport(workbook, sheetName, headerRow), mapping);

  // Reuse only competitors of this tournament's tenant that the caller
  // can already see (admins: the tenant scope alone).
  const accessFilter = await buildCompetitorAccessFilter(authReq, prisma);
  const matchScope: Prisma.CompetitorWhereInput = {
    AND: [tournamentCompetitorScope(tournament.organizationId), ...(accessFilter ? [accessFilter] : [])],
  };
  const importInput = {
    tournament: {
      id: tournament.id,
      date: tournament.date,
      organizationId: tournament.organizationId,
      maxCapacity: tournament.maxCapacity,
      waitlistEnabled: tournament.waitlistEnabled,
      plan: tournament.organization?.plan ?? 'free',
    },
    rows,
    skipped,
    matchScope,
  };

  if (!body.commit) {
    const { summary } = await planTournamentImport(prisma, importInput);
    return res.json({ ...meta, summary, committed: false });
  }

  let summary: TournamentImportSummary;
  try {
    summary = await applyTournamentImport(prisma, importInput);
  } catch (error: unknown) {
    if (error instanceof TournamentImportNotFoundError) return res.status(404).json({ error: 'Tournament not found' });
    if (error instanceof TournamentImportLimitError) {
      const { limit, current, requested } = error.planLimit;
      // Same shape as bulk registration's limit response.
      return res.status(402).json({
        error: `Your plan is limited to ${limit} competitors per tournament. You have ${current} registered and this file would add ${requested} more.`,
        code: 'COMPETITOR_LIMIT_REACHED',
        limit,
        current,
        requested,
      });
    }
    throw error;
  }

  await createAuditLog(prisma, {
    userId: authReq.user!.id,
    action: 'tournament_spreadsheet_import',
    details: {
      tournamentId,
      tournamentName: tournament.name,
      newCompetitors: summary.newCompetitors,
      matchedCompetitors: summary.matchedCompetitors,
      registrationsCreated: summary.registrationsToCreate,
      waitlisted: summary.waitlisted,
      registrationsUpdated: summary.registrationsUpdated,
      skipped: summary.skippedCount,
    },
    ipAddress: getClientIp(authReq),
    userAgent: getUserAgent(authReq),
    organizationId: tournament.organizationId || undefined,
    tournamentId,
  }).catch((err) => {
    console.error('[audit-log] tournament import event failed:', err);
  });

  res.json({ ...meta, summary, committed: true });
});

export default router;

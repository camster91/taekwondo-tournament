/**
 * The single-certificate PDF's Content-Disposition used the raw competitor
 * last name. Node rejects non-Latin-1 header characters (ERR_INVALID_CHAR),
 * so a name like "Nguyễn" or "김" turned the download into a 500.
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireTournamentAccess: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkTournamentAccess: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../services/match-advancement.js', () => ({
  advanceWinner: vi.fn(),
  handleByeMatches: vi.fn(),
  getBracketPlacements: vi.fn(async () => [{ place: 1, competitorId: 'reg-1' }]),
  resolveNextMatchSlots: vi.fn(),
  pickSlotsToNull: vi.fn(),
  validateMatchStatusTransition: vi.fn(),
}));

vi.mock('../services/pdf-export.js', () => ({
  generateBracketPDF: vi.fn(),
  generateBatchBracketsPDF: vi.fn(),
  generateResultsPDF: vi.fn(),
  generateCertificatePDF: vi.fn(() => ({ output: () => new ArrayBuffer(4) })),
  generateBatchCertificatesPDF: vi.fn(),
  generateSchoolReportPDF: vi.fn(),
}));

import bracketsRouter from './brackets.js';

function makeApp(lastName: string) {
  const app = express();
  app.locals.prisma = {
    division: {
      findUnique: vi.fn(async () => ({
        id: 'div-1',
        tournamentId: 't-1',
        name: 'Div',
        eventType: 'patterns',
        bracket: { id: 'b-1' },
        tournament: {
          name: 'Open',
          date: new Date('2027-01-01'),
          location: 'Gym',
          sportProfileSlug: 'taekwondo',
          brandName: null,
          brandLogoUrl: null,
          brandPrimaryColor: null,
        },
      })),
    },
    registration: {
      findUnique: vi.fn(async () => ({ id: 'reg-1', competitor: { firstName: 'A', lastName } })),
    },
  };
  app.use('/api/brackets', bracketsRouter);
  return app;
}

describe('GET /api/brackets/division/:divisionId/certificate/:place', () => {
  it.each(['Nguyễn', '김', 'O\'Brien "x"'])('serves a safe filename for last name %s', async (lastName) => {
    const res = await request(makeApp(lastName)).get('/api/brackets/division/div-1/certificate/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="certificate_[A-Za-z0-9_]+_1\.pdf"$/);
  });

  it('keeps an ASCII last name readable', async () => {
    const res = await request(makeApp('Smith')).get('/api/brackets/division/div-1/certificate/1');

    expect(res.headers['content-disposition']).toBe('attachment; filename="certificate_Smith_1.pdf"');
  });
});

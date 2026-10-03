/**
 * Classic paper bracket downloads (#12) and the tournament-level default
 * bracket format (#13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { inflateRawSync } from 'zlib';

const accessMocks = vi.hoisted(() => ({
  checkTournamentAccess: vi.fn(async () => ({ ok: true }) as { ok: boolean; status?: number; error?: string }),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireTournamentAccess: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkTournamentAccess: accessMocks.checkTournamentAccess,
}));

vi.mock('../services/match-advancement.js', () => ({
  handleByeMatches: vi.fn(),
  getBracketPlacements: vi.fn(),
  validateMatchStatusTransition: vi.fn(),
  lockBracket: vi.fn(),
  syncBracketAdvancement: vi.fn(),
  summarizeBracketUpdates: vi.fn(),
}));

vi.mock('../services/websocket.js', () => ({
  broadcastMatchUpdate: vi.fn(),
  broadcastBracketRegenerated: vi.fn(),
}));

import bracketsRouter from './brackets.js';

const reg = (id: string, firstName: string, danRank: number | null = null) => ({
  id,
  competitor: { firstName, lastName: 'Test', schoolDojang: 'Newtons TKD', danRank },
});

function division(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    beltLevel: 'CB',
    gender: 'F',
    eventType: 'sparring',
    ageMin: 10,
    ageMax: 11,
    weightClass: 'Heavy',
    beltColors: '["Blue","Red"]',
    danMin: null,
    danMax: null,
    assignments: [{ registration: reg('r1', 'Ana') }, { registration: reg('r2', 'Bea') }, { registration: reg('r3', 'Cy') }],
    bracket: null,
    ...overrides,
  };
}

function makeApp(divisions: unknown[]) {
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    division: { findUnique: vi.fn(async () => ({ tournamentId: 't-1' })) },
    tournament: {
      findUnique: vi.fn(async () => ({
        name: 'Newtons Open',
        date: new Date('2027-05-01'),
        location: 'Markham',
        brandName: null,
        sportProfileSlug: 'taekwondo',
        divisions,
      })),
    },
  };
  app.use('/api/brackets', bracketsRouter);
  return app;
}

function binary(res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

/** File names inside a ZIP, read from its local headers. */
function zipEntries(zip: Buffer): Array<{ name: string; data: Buffer }> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const body = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    entries.push({ name, data: method === 8 ? inflateRawSync(body) : Buffer.from(body) });
    offset += 30 + nameLength + size;
  }
  return entries;
}

beforeEach(() => {
  accessMocks.checkTournamentAccess.mockClear();
  accessMocks.checkTournamentAccess.mockResolvedValue({ ok: true });
});

describe('GET /api/brackets/division/:divisionId/classic-pdf', () => {
  it('returns a PDF named after the division', async () => {
    const app = makeApp([division('d1', '10-11 CB-All Blue/Red Belts Females Sparring Heavy')]);
    const res = await request(app).get('/api/brackets/division/d1/classic-pdf').buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="10-11 CB-All Blue_Red Belts Females Sparring Heavy.pdf"',
    );
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(accessMocks.checkTournamentAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 't-1', 'viewer');
  });

  it('refuses when the viewer cannot open the tournament', async () => {
    accessMocks.checkTournamentAccess.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    const res = await request(makeApp([division('d1', 'Div')])).get('/api/brackets/division/d1/classic-pdf');
    expect(res.status).toBe(403);
  });

  it('404s for a division in the trash (filtered out of the query)', async () => {
    const res = await request(makeApp([])).get('/api/brackets/division/d1/classic-pdf');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/brackets/tournament/:tournamentId/classic-zip', () => {
  it('returns a ZIP with one PDF per division in old-style folders', async () => {
    const app = makeApp([
      division('d1', '10-11 CB-All Blue/Red Belts Females Sparring Heavy'),
      division('d2', '12-13 BB 1st Dan Males Patterns', {
        beltLevel: 'BB', gender: 'M', eventType: 'patterns', danMin: 1, danMax: 1, weightClass: null,
        assignments: [{ registration: reg('r9', 'Dan', 1) }],
      }),
      division('d3', 'Empty division', { assignments: [] }),
    ]);
    const res = await request(app).get('/api/brackets/tournament/t-1/classic-zip').buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/zip/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Newtons_Open_classic_brackets.zip"');
    const entries = zipEntries(res.body as Buffer);
    expect(entries.map((e) => e.name)).toEqual([
      'CB Females Sparring/10-11 CB-All Blue_Red Belts Females Sparring Heavy.pdf',
      'BB Males Patterns/12-13 BB 1st Dan Males Patterns.pdf',
    ]);
    for (const entry of entries) expect(entry.data.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('404s when no division has competitors', async () => {
    const res = await request(makeApp([division('d3', 'Empty', { assignments: [] })])).get('/api/brackets/tournament/t-1/classic-zip');
    expect(res.status).toBe(404);
  });
});

describe('tournament default bracket format', () => {
  function makeGenerateApp(settings: string | null) {
    const created: Array<{ format: string }> = [];
    const tx = {
      bracket: { create: vi.fn(async ({ data }: { data: { format: string } }) => { created.push(data); return { id: 'b-1' }; }) },
      match: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const app = express();
    app.use(express.json());
    app.locals.prisma = {
      tournament: { findUnique: vi.fn(async () => ({ settings })) },
      division: {
        findMany: vi.fn(async () => [{
          id: 'd1',
          name: 'Div',
          bracket: null,
          assignments: [1, 2, 3, 4].map((n) => ({
            registrationId: `r${n}`,
            seedPosition: n,
            registration: { competitor: { firstName: `C${n}`, lastName: 'X', schoolDojang: `S${n}` } },
          })),
        }]),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    app.use('/api/brackets', bracketsRouter);
    return { app, created };
  }

  it('uses single elimination when the tournament default says so', async () => {
    const { app, created } = makeGenerateApp(JSON.stringify({ defaultBracketFormat: 'single_elim' }));
    const res = await request(app).post('/api/brackets/tournament/t-1/generate-all').send({ seedingStrategy: 'school_spread' });
    expect(res.status).toBe(200);
    expect(created.map((c) => c.format)).toEqual(['single_elim']);
  });

  it('keeps double elimination when no default is set', async () => {
    const { app, created } = makeGenerateApp(null);
    await request(app).post('/api/brackets/tournament/t-1/generate-all').send({});
    expect(created.map((c) => c.format)).toEqual(['double_elim']);
  });

  it('lets an explicit format win over the tournament default', async () => {
    const { app, created } = makeGenerateApp(JSON.stringify({ defaultBracketFormat: 'single_elim' }));
    await request(app).post('/api/brackets/tournament/t-1/generate-all').send({ format: 'round_robin' });
    expect(created.map((c) => c.format)).toEqual(['round_robin']);
  });
});

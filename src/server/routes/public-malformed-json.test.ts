import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { toApiError } from '../utils/errors.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('POST /api/public/register malformed JSON', () => {
  it('returns a structured 400 response instead of an internal error', async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.post('/api/public/register', (_req, res) => res.status(204).send());
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const apiError = toApiError(err);
      res.status(apiError.statusCode).json({
        error: apiError.error,
        code: apiError.code,
        recoverable: apiError.recoverable,
      });
    });

    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/public/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"tournamentId":"fabricated-qa",',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Malformed JSON request body',
      code: 'VALIDATION_ERROR',
      recoverable: true,
    });
  });
});

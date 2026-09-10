/**
 * Regression test for the magic-link `usedAt` race.
 *
 * Track-1 security review finding 3.4 (HIGH):
 *   The verify-magic-link handler flipped `usedAt` with an unconditional
 *   `prisma.magicLink.update` after the lookup. Two concurrent verifies
 *   (user double-click, network race, or attacker retry with a stolen
 *   link) both passed the `usedAt: null` findFirst, then both `update`d
 *   the same row, then both minted a JWT — one link = two sessions.
 *
 * The fix replaces the unconditional `update` with `updateMany({
 *   where: { id, usedAt: null } })` and bails on `count === 0`. The
 * second concurrent request sees count 0 and is rejected as "Invalid
 * or expired link/code" — same response a third, fourth, … retry
 * receives.
 *
 * This test pins that behavior at the route boundary. The race itself
 * is triggered by the test infrastructure (sequential calls) but the
 * fix's correctness is the `count === 0 → 400` branch; exercising
 * that branch is enough to lock the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}));

const originalEnv = { ...process.env };
const servers: Server[] = [];

interface MockState {
  updateMany: ReturnType<typeof vi.fn>;
  usedAt: Date | null;
  /** Captures the result of every `updateMany` call (1 = first, 0 = already used). */
  callLog: number[];
}

async function startAuthServer(state: MockState): Promise<string> {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_DISABLED = '1';

  state.updateMany = vi.fn().mockImplementation(() => {
    if (state.usedAt !== null) {
      state.callLog.push(0);
      return Promise.resolve({ count: 0 });
    }
    state.usedAt = new Date();
    state.callLog.push(1);
    return Promise.resolve({ count: 1 });
  });

  const { default: authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.locals.prisma = {
    magicLink: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'race-link-1',
        email: 'race-user@example.com',
        token: 'race-token',
        code: 'hashed-code',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: state.usedAt,
        failedAttempts: 0,
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: state.updateMany,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'race-user-id',
        email: 'race-user@example.com',
        firstName: 'Race',
        lastName: 'User',
        role: 'viewer',
        isActive: true,
        tokenVersion: 0,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return `http://127.0.0.1:${address.port}/api/auth`;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  process.env = { ...originalEnv };
});

describe('verify-magic-link atomic usedAt claim', () => {
  it('rejects a second verify with the same link after the first claim', async () => {
    const state: MockState = { updateMany: vi.fn(), usedAt: null, callLog: [] };
    const baseUrl = await startAuthServer(state);

    // First verify: updateMany returns count=1, link flips to used.
    const first = await fetch(`${baseUrl}/verify-magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'race-token' }),
    });
    expect(first.status).toBe(200);

    // Second verify of the same token: the mock's `usedAt` is now set,
    // so updateMany returns count=0. The route must reject it.
    const second = await fetch(`${baseUrl}/verify-magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'race-token' }),
    });
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ error: 'Invalid or expired link/code' });

    // Both calls must have hit updateMany; the second saw count=0.
    expect(state.callLog).toEqual([1, 0]);
  });

  it('mints the session cookie exactly once across two verify calls', async () => {
    const state: MockState = { updateMany: vi.fn(), usedAt: null, callLog: [] };
    const baseUrl = await startAuthServer(state);

    const first = await fetch(`${baseUrl}/verify-magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'race-token' }),
    });
    const second = await fetch(`${baseUrl}/verify-magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'race-token' }),
    });

    const firstSetCookie = first.headers.get('set-cookie') ?? '';
    const secondSetCookie = second.headers.get('set-cookie') ?? '';

    // The first response carries the session cookie; the second does not.
    expect(firstSetCookie).toMatch(/bowin_session=/);
    expect(secondSetCookie).not.toMatch(/bowin_session=/);
  });
});

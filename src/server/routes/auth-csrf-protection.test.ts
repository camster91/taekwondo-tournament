/**
 * End-to-end tests for CSRF protection with HttpOnly session cookies.
 *
 * Acceptance criteria from Phase 0:
 *  - P0-2: SESSION_COOKIE httpOnly:true + CSRF protection
 *  - Cookie-based auth requires double-submit CSRF token on mutations
 *  - Bearer token auth (tests, scripts) is exempt from CSRF
 *  - CSRF cookie is readable (not HttpOnly) so client can read and send header
 *  - Session cookie is HttpOnly (cannot be read by JS)
 *
 * Test strategy:
 *  1. Verify session cookie is HttpOnly
 *  2. Verify CSRF cookie is NOT HttpOnly
 *  3. Verify mutations with cookie auth fail without CSRF header
 *  4. Verify mutations with cookie auth succeed with matching CSRF header
 *  5. Verify Bearer token mutations work without CSRF (exemption)
 *  6. Verify CSRF mismatch fails
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createToken, SESSION_COOKIE, CSRF_COOKIE } from '../middleware/auth.js';
import authRouter from './auth.js';
import type { Server } from 'http';

const TEST_PORT = 3098;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let prisma: PrismaClient;
let server: Server;
let testUserId: string;

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required for tests');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  // Create test user
  const testUser = await prisma.user.create({
    data: {
      email: 'test-csrf@example.com',
      firstName: 'CSRF',
      lastName: 'Test',
      role: 'admin',
      tokenVersion: 0,
      isActive: true,
    },
  });
  testUserId = testUser.id;

  // Start test server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.locals.prisma = prisma;
  app.use('/api/auth', authRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });
});

afterAll(async () => {
  // Clean up test user
  await prisma.user.deleteMany({
    where: { email: 'test-csrf@example.com' },
  });

  await prisma.$disconnect();
  server.close();
});

/**
 * Helper to parse Set-Cookie headers and extract cookie attributes
 */
function parseCookies(setCookieHeaders: string[]): Map<string, { value: string; httpOnly: boolean; secure: boolean }> {
  const cookies = new Map();
  for (const header of setCookieHeaders) {
    const parts = header.split(';').map((p) => p.trim());
    const [nameValue, ...attrs] = parts;
    const [name, value] = nameValue.split('=');
    cookies.set(name, {
      value,
      httpOnly: attrs.some((a) => a.toLowerCase() === 'httponly'),
      secure: attrs.some((a) => a.toLowerCase() === 'secure'),
    });
  }
  return cookies;
}

describe('Cookie attributes', () => {
  it('sets SESSION_COOKIE as HttpOnly', async () => {
    // Create a magic link and verify to get session cookie
    await prisma.magicLink.create({
      data: {
        email: 'test-csrf@example.com',
        token: 'csrf-test-token',
        code: '123456',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const verifyResponse = await fetch(`${BASE_URL}/api/auth/verify-magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'csrf-test-token' }),
    });

    expect(verifyResponse.status).toBe(200);

    const setCookieHeaders = verifyResponse.headers.raw()['set-cookie'] || [];
    const cookies = parseCookies(setCookieHeaders);

    expect(cookies.has(SESSION_COOKIE)).toBe(true);
    expect(cookies.get(SESSION_COOKIE)?.httpOnly).toBe(true);
  });

  it('sets CSRF_COOKIE as readable (NOT HttpOnly)', async () => {
    await prisma.magicLink.create({
      data: {
        email: 'test-csrf@example.com',
        token: 'csrf-test-token-2',
        code: '654321',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const verifyResponse = await fetch(`${BASE_URL}/api/auth/verify-magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'csrf-test-token-2' }),
    });

    expect(verifyResponse.status).toBe(200);

    const setCookieHeaders = verifyResponse.headers.raw()['set-cookie'] || [];
    const cookies = parseCookies(setCookieHeaders);

    expect(cookies.has(CSRF_COOKIE)).toBe(true);
    expect(cookies.get(CSRF_COOKIE)?.httpOnly).toBe(false);
  });
});

describe('CSRF protection for cookie-based auth', () => {
  it('rejects POST /logout with cookie but no CSRF header', async () => {
    // Create valid session + CSRF cookies
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const csrfValue = 'test-csrf-value-abc123';

    // Simulate a request with cookies but no CSRF header
    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
      },
    });

    expect(logoutResponse.status).toBe(403);
    const body = await logoutResponse.json();
    expect(body.error).toBe('CSRF token missing or invalid');
  });

  it('rejects POST /logout with mismatched CSRF token', async () => {
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const csrfValue = 'test-csrf-value-def456';

    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
        'x-csrf-token': 'wrong-csrf-value',
      },
    });

    expect(logoutResponse.status).toBe(403);
    const body = await logoutResponse.json();
    expect(body.error).toBe('CSRF token missing or invalid');
  });

  it('accepts POST /logout with matching CSRF token', async () => {
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const csrfValue = 'test-csrf-value-ghi789';

    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
        'x-csrf-token': csrfValue,
      },
    });

    expect(logoutResponse.status).toBe(200);
    const body = await logoutResponse.json();
    expect(body.success).toBe(true);
  });

  it('allows GET /me with cookie auth (no CSRF required for reads)', async () => {
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const meResponse = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}`,
      },
    });

    expect(meResponse.status).toBe(200);
    const body = await meResponse.json();
    expect(body.email).toBe('test-csrf@example.com');
  });
});

describe('Bearer token exemption from CSRF', () => {
  it('accepts POST /logout with Bearer token (no CSRF required)', async () => {
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
      },
    });

    expect(logoutResponse.status).toBe(200);
    const body = await logoutResponse.json();
    expect(body.success).toBe(true);
  });

  it('accepts PUT /users/:id/role with Bearer token (no CSRF required)', async () => {
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const roleResponse = await fetch(`${BASE_URL}/api/auth/users/${testUserId}/role`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(roleResponse.status).toBe(200);
  });
});

describe('CSRF for other mutation methods', () => {
  it('requires CSRF for PUT with cookie auth', async () => {
    const jwt = createToken({
      userId: testUserId,
      email: 'test-csrf@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const csrfValue = 'test-csrf-put-123';

    // Without CSRF header
    const putResponse1 = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ firstName: 'Updated' }),
    });

    expect(putResponse1.status).toBe(403);

    // With matching CSRF header
    const putResponse2 = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
        'x-csrf-token': csrfValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ firstName: 'Updated' }),
    });

    expect(putResponse2.status).toBe(200);
  });

  it('requires CSRF for DELETE with cookie auth', async () => {
    // Create a temporary user for deletion test
    const tempUser = await prisma.user.create({
      data: {
        email: 'temp-delete-csrf@example.com',
        firstName: 'Temp',
        lastName: 'User',
        role: 'viewer',
        tokenVersion: 0,
        isActive: true,
        lastLogin: new Date(),
      },
    });

    const jwt = createToken({
      userId: tempUser.id,
      email: 'temp-delete-csrf@example.com',
      role: 'viewer',
      tokenVersion: 0,
    });

    const csrfValue = 'test-csrf-delete-456';

    // Without CSRF header
    const deleteResponse1 = await fetch(`${BASE_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'temp-delete-csrf@example.com' }),
    });

    expect(deleteResponse1.status).toBe(403);

    // With matching CSRF header
    const deleteResponse2 = await fetch(`${BASE_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE}=${jwt}; ${CSRF_COOKIE}=${csrfValue}`,
        'x-csrf-token': csrfValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'temp-delete-csrf@example.com' }),
    });

    expect(deleteResponse2.status).toBe(204);
  });
});

/**
 * End-to-end tests for session invalidation via tokenVersion bump.
 *
 * Acceptance criteria from Phase 0:
 *  - P0-1: JWT token revocation via tokenVersion bump on logout / isActive flip
 *  - Sessions must die immediately after:
 *    1. User logs out (POST /logout)
 *    2. Admin flips isActive to false (PUT /users/:id/status)
 *    3. Admin changes a user's role (PUT /users/:id/role)
 *
 * Test strategy:
 *  1. Issue a valid JWT for a user
 *  2. Verify the JWT works (GET /me returns 200)
 *  3. Trigger invalidation (logout / status change / role change)
 *  4. Verify the JWT is rejected (GET /me returns 401 with "Session invalidated")
 *  5. Verify a fresh login issues a new JWT that works
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createToken } from '../middleware/auth.js';
import authRouter from './auth.js';
import type { Server } from 'http';

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let prisma: PrismaClient;
let server: Server;
let testUserId: string;
let adminUserId: string;

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required for tests');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  // Create test users
  const testUser = await prisma.user.create({
    data: {
      email: 'test-session-inv@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'viewer',
      tokenVersion: 0,
      isActive: true,
    },
  });
  testUserId = testUser.id;

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin-session-inv@example.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      tokenVersion: 0,
      isActive: true,
    },
  });
  adminUserId = adminUser.id;

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
  // Clean up test users
  await prisma.user.deleteMany({
    where: {
      email: {
        in: ['test-session-inv@example.com', 'admin-session-inv@example.com'],
      },
    },
  });

  await prisma.$disconnect();
  server.close();
});

describe('Session invalidation via logout', () => {
  it('invalidates JWT after logout', async () => {
    // Get fresh user state
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { tokenVersion: true },
    });

    // Issue a JWT
    const jwt = createToken({
      userId: testUserId,
      email: 'test-session-inv@example.com',
      role: 'viewer',
      tokenVersion: user!.tokenVersion,
    });

    // Verify JWT works
    const meResponse1 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meResponse1.status).toBe(200);

    // Logout (bumps tokenVersion)
    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(logoutResponse.status).toBe(200);

    // Verify JWT is now rejected
    const meResponse2 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meResponse2.status).toBe(401);
    const body2 = await meResponse2.json();
    expect(body2.error).toBe('Session invalidated');
  });

  it('allows new login after logout', async () => {
    // Get fresh user state
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { tokenVersion: true },
    });

    // Issue a new JWT with the bumped tokenVersion
    const newJwt = createToken({
      userId: testUserId,
      email: 'test-session-inv@example.com',
      role: 'viewer',
      tokenVersion: user!.tokenVersion,
    });

    // Verify new JWT works
    const meResponse = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${newJwt}` },
    });
    expect(meResponse.status).toBe(200);
  });
});

describe('Session invalidation via isActive flip', () => {
  it('invalidates JWT when admin sets isActive=false', async () => {
    // Get fresh user state
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { tokenVersion: true },
    });

    // Issue a JWT
    const jwt = createToken({
      userId: testUserId,
      email: 'test-session-inv@example.com',
      role: 'viewer',
      tokenVersion: user!.tokenVersion,
    });

    // Verify JWT works
    const meResponse1 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meResponse1.status).toBe(200);

    // Admin flips isActive to false (bumps tokenVersion)
    const adminJwt = createToken({
      userId: adminUserId,
      email: 'admin-session-inv@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const statusResponse = await fetch(`${BASE_URL}/api/auth/users/${testUserId}/status`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ isActive: false }),
    });
    expect(statusResponse.status).toBe(200);

    // Verify JWT is now rejected (isActive check happens first)
    const meResponse2 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meResponse2.status).toBe(401);
    const body2 = await meResponse2.json();
    expect(body2.error).toBe('User not found or inactive');

    // Re-activate for next tests
    await prisma.user.update({
      where: { id: testUserId },
      data: { isActive: true },
    });
  });
});

describe('Session invalidation via role change', () => {
  it('invalidates JWT when admin changes user role', async () => {
    // Get fresh user state
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { tokenVersion: true },
    });

    // Issue a JWT
    const jwt = createToken({
      userId: testUserId,
      email: 'test-session-inv@example.com',
      role: 'viewer',
      tokenVersion: user!.tokenVersion,
    });

    // Verify JWT works
    const meResponse1 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meResponse1.status).toBe(200);

    // Admin changes role (bumps tokenVersion)
    const adminJwt = createToken({
      userId: adminUserId,
      email: 'admin-session-inv@example.com',
      role: 'admin',
      tokenVersion: 0,
    });

    const roleResponse = await fetch(`${BASE_URL}/api/auth/users/${testUserId}/role`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'scorekeeper' }),
    });
    expect(roleResponse.status).toBe(200);

    // Verify JWT is now rejected
    const meResponse2 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meResponse2.status).toBe(401);
    const body2 = await meResponse2.json();
    expect(body2.error).toBe('Session invalidated');

    // Verify new JWT with updated role works
    const newUser = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { tokenVersion: true, role: true },
    });

    const newJwt = createToken({
      userId: testUserId,
      email: 'test-session-inv@example.com',
      role: newUser!.role,
      tokenVersion: newUser!.tokenVersion,
    });

    const meResponse3 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${newJwt}` },
    });
    expect(meResponse3.status).toBe(200);
    const body3 = await meResponse3.json();
    expect(body3.role).toBe('scorekeeper');

    // Restore original role
    await prisma.user.update({
      where: { id: testUserId },
      data: { role: 'viewer' },
    });
  });
});

describe('Legacy token rejection', () => {
  it('rejects tokens without tokenVersion field', async () => {
    // Create a token without tokenVersion (simulates legacy token)
    const legacyJwt = createToken({
      userId: testUserId,
      email: 'test-session-inv@example.com',
      role: 'viewer',
      tokenVersion: undefined as any, // Force undefined to simulate legacy
    });

    // Verify legacy token is rejected
    const meResponse = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${legacyJwt}` },
    });
    expect(meResponse.status).toBe(401);
    const body = await meResponse.json();
    expect(body.error).toBe('Session invalidated');
  });
});

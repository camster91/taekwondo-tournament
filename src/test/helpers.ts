/**
 * Test helpers for integration tests
 * 
 * Provides utilities for creating test servers, authenticated requests,
 * and cleaning up test data.
 */

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { Test } from 'supertest';
import { createToken } from '../server/middleware/auth.js';

type Application = ReturnType<typeof express>;

let testPrisma: PrismaClient | null = null;

interface TestServer {
  app: Application;
  prisma: PrismaClient;
}

/**
 * Create a test Express server with Prisma client
 */
export async function createTestServer(): Promise<TestServer> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for integration tests');
  }

  const app = express();
  app.use(express.json());

  // Create Prisma client if not already created
  if (!testPrisma) {
    testPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  app.locals.prisma = testPrisma;

  return { app, prisma: testPrisma };
}

/**
 * Clean up test data by deleting all records from specified tables
 */
export async function cleanupTestData(
  prisma: PrismaClient,
  tables: Array<keyof PrismaClient> = []
): Promise<void> {
  // If no specific tables provided, clean common test tables in dependency order
  const defaultTables: Array<keyof PrismaClient> = [
    'customDomain',
    'organizationMember',
    'userTournamentAccess',
    'user',
    'organization',
  ];

  const tablesToClean = tables.length > 0 ? tables : defaultTables;

  for (const table of tablesToClean) {
    const model = prisma[table] as unknown as { deleteMany?: (args: object) => Promise<unknown> } | undefined;
    if (model && typeof model.deleteMany === 'function') {
      await model.deleteMany({});
    }
  }
}

interface AuthenticatedAgent {
  get(url: string): Test;
  post(url: string): Test;
  put(url: string): Test;
  patch(url: string): Test;
  delete(url: string): Test;
}

/**
 * Create a supertest agent for `app` whose requests carry a valid JWT.
 *
 * Usage: `createAuthenticatedRequest(app, user.id).post('/api/...').send(...)`
 *
 * `tokenVersion` must match the user's DB `tokenVersion` (0 for a freshly
 * created user) or the auth middleware rejects the token.
 */
export function createAuthenticatedRequest(
  app: Application,
  userId: string,
  role: string = 'admin',
  tokenVersion: number = 0
): AuthenticatedAgent {
  const token = createToken({
    userId,
    email: `test-${userId}@example.com`,
    role,
    tokenVersion,
  });
  const agent = request(app);
  const withAuth = (test: Test): Test => test.set('Authorization', `Bearer ${token}`);

  return {
    get: (url) => withAuth(agent.get(url)),
    post: (url) => withAuth(agent.post(url)),
    put: (url) => withAuth(agent.put(url)),
    patch: (url) => withAuth(agent.patch(url)),
    delete: (url) => withAuth(agent.delete(url)),
  };
}

/**
 * Disconnect Prisma client (call in afterAll hooks)
 */
export async function disconnectTestPrisma(): Promise<void> {
  if (testPrisma) {
    await testPrisma.$disconnect();
    testPrisma = null;
  }
}

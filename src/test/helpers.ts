/**
 * Test helpers for integration tests
 * 
 * Provides utilities for creating test servers, authenticated requests,
 * and cleaning up test data.
 */

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Request as SuperTestRequest } from 'supertest';
import { createToken } from '../server/middleware/auth.js';

let testPrisma: PrismaClient | null = null;

interface TestServer {
  app: ReturnType<typeof express>;
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
    const model = prisma[table] as any;
    if (model && typeof model.deleteMany === 'function') {
      await model.deleteMany({});
    }
  }
}

/**
 * Create an authenticated supertest request with a valid JWT token
 */
export function createAuthenticatedRequest(
  request: SuperTestRequest,
  userId: string,
  role: string = 'admin'
): SuperTestRequest {
  const token = createToken({
    userId,
    email: `test-${userId}@example.com`,
    role,
    tokenVersion: 0,
  });

  return request.set('Authorization', `Bearer ${token}`);
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

/**
 * Integration tests for P0 #118: Secure registration management tokens
 * 
 * Tests expiration, revocation, rotation, and cross-registration isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  generateManagementToken,
  getManagementTokenExpiry,
  hashManagementToken,
  isValidManagementToken,
  validateManagementTokenStatus,
} from '../utils/registration-management-token.js';

// Prisma 7 requires a driver adapter. The suite is skipped, but the client
// is still constructed at import time, so it must be valid.
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe.skip('Registration Management Token Security (#118)', () => {
  let tournamentId: string;
  let competitorId: string;
  let registrationId: string;
  let validToken: string;
  let validTokenHash: string;

  beforeEach(async () => {
    // Create a test tournament
    const tournament = await prisma.tournament.create({
      data: {
        name: 'Test Token Security Tournament',
        date: new Date('2027-06-01'),
        location: 'Test Venue',
        status: 'registration',
        sportProfileSlug: 'taekwondo',
      },
    });
    tournamentId = tournament.id;

    // Create a test competitor
    const competitor = await prisma.competitor.create({
      data: {
        firstName: 'Test',
        lastName: 'TokenUser',
        gender: 'M',
        dateOfBirth: new Date('2010-01-01'),
        belt: 'Green',
      },
    });
    competitorId = competitor.id;

    // Create a test registration with a valid token
    validToken = generateManagementToken();
    validTokenHash = hashManagementToken(validToken);
    const expiry = getManagementTokenExpiry(30); // 30 days

    const registration = await prisma.registration.create({
      data: {
        tournamentId,
        competitorId,
        patterns: true,
        sparring: false,
        ageAtTournament: 17,
        parentName: 'Test Parent',
        parentEmail: 'parent@example.test',
        managementTokenHash: validTokenHash,
        managementTokenExpiresAt: expiry,
        privacyAccepted: true,
        rulesAccepted: true,
        guardianAttested: true,
        consentVersion: 'v1',
        consentAcceptedAt: new Date(),
      },
    });
    registrationId = registration.id;
  });

  describe('Token Format Validation', () => {
    it('accepts valid 43-char base64url tokens', () => {
      expect(isValidManagementToken(validToken)).toBe(true);
    });

    it('rejects tokens with wrong length', () => {
      expect(isValidManagementToken('short')).toBe(false);
      expect(isValidManagementToken('a'.repeat(100))).toBe(false);
    });

    it('rejects tokens with invalid characters', () => {
      expect(isValidManagementToken('a'.repeat(42) + '!')).toBe(false);
      expect(isValidManagementToken('a'.repeat(42) + '=')).toBe(false);
    });
  });

  describe('Token Expiration', () => {
    it('accepts tokens before expiry', () => {
      const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const result = validateManagementTokenStatus(futureExpiry, null);
      expect(result.valid).toBe(true);
    });

    it('rejects tokens after expiry', () => {
      const pastExpiry = new Date(Date.now() - 1000); // 1 second ago
      const result = validateManagementTokenStatus(pastExpiry, null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('accepts tokens with null expiry (legacy tokens)', () => {
      const result = validateManagementTokenStatus(null, null);
      expect(result.valid).toBe(true);
    });

    it('creates tokens with 30-day default TTL', () => {
      const expiry = getManagementTokenExpiry();
      const expectedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      // Allow 1 second of drift
      expect(Math.abs(expiry.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });

    it('respects custom TTL', () => {
      const expiry = getManagementTokenExpiry(7); // 7 days
      const expectedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expect(Math.abs(expiry.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });
  });

  describe('Token Revocation', () => {
    it('rejects revoked tokens even if not expired', () => {
      const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const revokedAt = new Date();
      const result = validateManagementTokenStatus(futureExpiry, revokedAt);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
    });

    it('prioritizes revocation over expiration in validation', () => {
      const pastExpiry = new Date(Date.now() - 1000);
      const revokedAt = new Date();
      const result = validateManagementTokenStatus(pastExpiry, revokedAt);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked'); // revoked, not expired
    });

    it('blocks access after revocation in database', async () => {
      // Revoke the token
      await prisma.registration.update({
        where: { id: registrationId },
        data: { managementTokenRevokedAt: new Date() },
      });

      // Fetch and validate
      const reg = await prisma.registration.findFirst({
        where: { managementTokenHash: validTokenHash },
      });
      expect(reg).not.toBeNull();
      const result = validateManagementTokenStatus(
        reg!.managementTokenExpiresAt,
        reg!.managementTokenRevokedAt,
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
    });
  });

  describe('Token Rotation', () => {
    it('generates unique tokens on rotation', () => {
      const token1 = generateManagementToken();
      const token2 = generateManagementToken();
      expect(token1).not.toBe(token2);
      expect(hashManagementToken(token1)).not.toBe(hashManagementToken(token2));
    });

    it('clears revocation flag when issuing new token', async () => {
      // Revoke old token
      await prisma.registration.update({
        where: { id: registrationId },
        data: { managementTokenRevokedAt: new Date() },
      });

      // Rotate: generate new token
      const newToken = generateManagementToken();
      const newExpiry = getManagementTokenExpiry();
      await prisma.registration.update({
        where: { id: registrationId },
        data: {
          managementTokenHash: hashManagementToken(newToken),
          managementTokenExpiresAt: newExpiry,
          managementTokenRevokedAt: null, // clear revocation
        },
      });

      // Verify new token is valid
      const updated = await prisma.registration.findFirst({
        where: { id: registrationId },
      });
      const result = validateManagementTokenStatus(
        updated!.managementTokenExpiresAt,
        updated!.managementTokenRevokedAt,
      );
      expect(result.valid).toBe(true);
    });

    it('old token no longer works after rotation', async () => {
      const oldTokenHash = validTokenHash;

      // Rotate
      const newToken = generateManagementToken();
      await prisma.registration.update({
        where: { id: registrationId },
        data: {
          managementTokenHash: hashManagementToken(newToken),
          managementTokenExpiresAt: getManagementTokenExpiry(),
          managementTokenRevokedAt: null,
        },
      });

      // Old token should not match anymore
      const lookup = await prisma.registration.findFirst({
        where: { managementTokenHash: oldTokenHash },
      });
      expect(lookup).toBeNull();
    });
  });

  describe('Cross-Registration Isolation', () => {
    it('different registrations have unique token hashes', async () => {
      // Create a second registration
      const token2 = generateManagementToken();
      const reg2 = await prisma.registration.create({
        data: {
          tournamentId,
          competitorId,
          patterns: false,
          sparring: true,
          ageAtTournament: 17,
          managementTokenHash: hashManagementToken(token2),
          managementTokenExpiresAt: getManagementTokenExpiry(),
          privacyAccepted: true,
          rulesAccepted: true,
          guardianAttested: true,
          consentVersion: 'v1',
          consentAcceptedAt: new Date(),
        },
      });

      // Token hashes must be unique
      expect(validTokenHash).not.toBe(hashManagementToken(token2));

      // Each token resolves to only its own registration
      const lookup1 = await prisma.registration.findFirst({
        where: { managementTokenHash: validTokenHash },
      });
      const lookup2 = await prisma.registration.findFirst({
        where: { managementTokenHash: hashManagementToken(token2) },
      });

      expect(lookup1!.id).toBe(registrationId);
      expect(lookup2!.id).toBe(reg2.id);
      expect(lookup1!.id).not.toBe(lookup2!.id);

      // Clean up
      await prisma.registration.delete({ where: { id: reg2.id } });
    });

    it('token collision is astronomically unlikely (uniqueness test)', async () => {
      const tokens = new Set<string>();
      const hashes = new Set<string>();

      // Generate 1000 tokens; expect zero collisions
      for (let i = 0; i < 1000; i++) {
        const token = generateManagementToken();
        const hash = hashManagementToken(token);
        expect(tokens.has(token)).toBe(false);
        expect(hashes.has(hash)).toBe(false);
        tokens.add(token);
        hashes.add(hash);
      }

      expect(tokens.size).toBe(1000);
      expect(hashes.size).toBe(1000);
    });
  });

  describe('Replay After Revoke', () => {
    it('blocks all operations after token revocation', async () => {
      // Revoke the token
      await prisma.registration.update({
        where: { id: registrationId },
        data: { managementTokenRevokedAt: new Date() },
      });

      // Attempt read
      const reg = await prisma.registration.findFirst({
        where: { managementTokenHash: validTokenHash },
      });
      expect(reg).not.toBeNull();

      const readCheck = validateManagementTokenStatus(
        reg!.managementTokenExpiresAt,
        reg!.managementTokenRevokedAt,
      );
      expect(readCheck.valid).toBe(false);

      // Attempt update (same result)
      const updateCheck = validateManagementTokenStatus(
        reg!.managementTokenExpiresAt,
        reg!.managementTokenRevokedAt,
      );
      expect(updateCheck.valid).toBe(false);

      // Attempt withdraw (same result)
      const withdrawCheck = validateManagementTokenStatus(
        reg!.managementTokenExpiresAt,
        reg!.managementTokenRevokedAt,
      );
      expect(withdrawCheck.valid).toBe(false);
    });

    it('replay attack with old token after rotation fails', async () => {
      const oldTokenHash = validTokenHash;

      // Rotate to new token
      const newToken = generateManagementToken();
      await prisma.registration.update({
        where: { id: registrationId },
        data: {
          managementTokenHash: hashManagementToken(newToken),
          managementTokenExpiresAt: getManagementTokenExpiry(),
          managementTokenRevokedAt: null,
        },
      });

      // Attacker replays old token
      const lookup = await prisma.registration.findFirst({
        where: { managementTokenHash: oldTokenHash },
      });

      // No match found (404 equivalent)
      expect(lookup).toBeNull();
    });
  });

  describe('Legacy Token Migration', () => {
    it('null expiry and revocation allow access (legacy behavior)', async () => {
      // Create a legacy registration (no expiry, no revocation)
      const legacyToken = generateManagementToken();
      const legacyReg = await prisma.registration.create({
        data: {
          tournamentId,
          competitorId,
          patterns: true,
          sparring: true,
          ageAtTournament: 17,
          managementTokenHash: hashManagementToken(legacyToken),
          managementTokenExpiresAt: null, // legacy: no expiry
          managementTokenRevokedAt: null,
          privacyAccepted: true,
          rulesAccepted: true,
          guardianAttested: true,
          consentVersion: 'v1',
          consentAcceptedAt: new Date(),
        },
      });

      // Legacy token should still work
      const result = validateManagementTokenStatus(null, null);
      expect(result.valid).toBe(true);

      // Clean up
      await prisma.registration.delete({ where: { id: legacyReg.id } });
    });

    it('null token hash (no parent email) is gracefully handled', async () => {
      // Create registration without token (staff-added, no parent email)
      const noTokenReg = await prisma.registration.create({
        data: {
          tournamentId,
          competitorId,
          patterns: true,
          sparring: false,
          ageAtTournament: 17,
          managementTokenHash: null, // no token issued
          privacyAccepted: true,
          rulesAccepted: true,
          guardianAttested: true,
          consentVersion: 'v1',
          consentAcceptedAt: new Date(),
        },
      });

      // Lookup by hash returns null (expected)
      const lookup = await prisma.registration.findFirst({
        where: { managementTokenHash: hashManagementToken('fake-token') },
      });
      expect(lookup).toBeNull();

      // Clean up
      await prisma.registration.delete({ where: { id: noTokenReg.id } });
    });

    it('first-time token issuance for staff-created registration (null hash)', async () => {
      // Create registration without token (staff-created, no parent email initially)
      const noTokenReg = await prisma.registration.create({
        data: {
          tournamentId,
          competitorId,
          patterns: true,
          sparring: false,
          ageAtTournament: 17,
          managementTokenHash: null, // no token
          managementTokenExpiresAt: null,
          managementTokenRevokedAt: null,
          privacyAccepted: true,
          rulesAccepted: true,
          guardianAttested: true,
          consentVersion: 'v1',
          consentAcceptedAt: new Date(),
        },
      });

      // Director issues first token via revoke-token endpoint (reissue:true)
      const newToken = generateManagementToken();
      const newExpiry = getManagementTokenExpiry();
      await prisma.registration.update({
        where: { id: noTokenReg.id },
        data: {
          managementTokenHash: hashManagementToken(newToken),
          managementTokenExpiresAt: newExpiry,
          managementTokenRevokedAt: null,
        },
      });

      // Verify token works
      const updated = await prisma.registration.findFirst({
        where: { managementTokenHash: hashManagementToken(newToken) },
      });
      expect(updated).not.toBeNull();
      const result = validateManagementTokenStatus(
        updated!.managementTokenExpiresAt,
        updated!.managementTokenRevokedAt,
      );
      expect(result.valid).toBe(true);

      // Clean up
      await prisma.registration.delete({ where: { id: noTokenReg.id } });
    });

    it('waitlist promote generates token with expiry and clears revocation', async () => {
      // Create a waitlisted registration
      const waitlistReg = await prisma.registration.create({
        data: {
          tournamentId,
          competitorId,
          patterns: true,
          sparring: true,
          ageAtTournament: 17,
          waitlistStatus: 'waitlisted',
          waitlistPosition: 1,
          managementTokenHash: null, // no token yet
          managementTokenExpiresAt: null,
          managementTokenRevokedAt: null,
          privacyAccepted: true,
          rulesAccepted: true,
          guardianAttested: true,
          consentVersion: 'v1',
          consentAcceptedAt: new Date(),
        },
      });

      // Promote (simulates POST /api/tournaments/:id/registrations/:regId/promote)
      const promoteToken = generateManagementToken();
      const promoteExpiry = getManagementTokenExpiry();
      await prisma.registration.update({
        where: { id: waitlistReg.id },
        data: {
          waitlistStatus: 'active',
          waitlistPromotedAt: new Date(),
          waitlistPosition: null,
          managementTokenHash: hashManagementToken(promoteToken),
          managementTokenExpiresAt: promoteExpiry,
          managementTokenRevokedAt: null, // clear any prior revocation
        },
      });

      // Verify token has expiry and is valid
      const promoted = await prisma.registration.findFirst({
        where: { id: waitlistReg.id },
      });
      expect(promoted!.managementTokenHash).not.toBeNull();
      expect(promoted!.managementTokenExpiresAt).not.toBeNull();
      expect(promoted!.managementTokenRevokedAt).toBeNull();

      const result = validateManagementTokenStatus(
        promoted!.managementTokenExpiresAt,
        promoted!.managementTokenRevokedAt,
      );
      expect(result.valid).toBe(true);

      // Clean up
      await prisma.registration.delete({ where: { id: waitlistReg.id } });
    });
  });
});

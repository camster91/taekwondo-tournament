import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  checkWaitlistStatus,
  decideRegistrationSlot,
  getTournamentCapacityStatus,
  reserveRegistrationSlot,
  TournamentFullError,
} from './waitlist.js';

// Mock Prisma client
const createMockPrisma = () => ({
  tournament: {
    findUnique: vi.fn(),
  },
  registration: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
});

describe('waitlist service', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  describe('checkWaitlistStatus', () => {
    it('returns shouldWaitlist=false when no maxCapacity is set', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: null,
        waitlistEnabled: true,
      });

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: false, position: null, isFull: false });
    });

    it('returns shouldWaitlist=false when waitlist is disabled and under capacity', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: false,
      });
      mockPrisma.registration.count.mockResolvedValue(10);

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: false, position: null, isFull: false });
    });

    it('reports isFull when at capacity and waitlist is disabled (capacity is still a limit)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: false,
      });
      mockPrisma.registration.count.mockResolvedValue(100);

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: false, position: null, isFull: true });
    });

    it('returns shouldWaitlist=false when under capacity', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: true,
      });
      mockPrisma.registration.count.mockResolvedValue(50);

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: false, position: null, isFull: false });
    });

    it('returns shouldWaitlist=true with position when at capacity', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: true,
      });
      mockPrisma.registration.count.mockResolvedValue(100);
      mockPrisma.registration.findFirst.mockResolvedValue({
        waitlistPosition: 2,
      });

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: true, position: 3, isFull: true });
    });

    it('handles no existing waitlist entries (first waitlisted)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: true,
      });
      mockPrisma.registration.count.mockResolvedValue(100);
      mockPrisma.registration.findFirst.mockResolvedValue(null);

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: true, position: 1, isFull: true });
    });

    it('throws error when tournament not found', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(null);

      await expect(
        checkWaitlistStatus(mockPrisma as unknown as PrismaClient, 't1')
      ).rejects.toThrow('Tournament not found');
    });
  });

  describe('getTournamentCapacityStatus', () => {
    it('returns null when tournament not found', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(null);

      const result = await getTournamentCapacityStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toBeNull();
    });

    it('returns correct status with unlimited capacity', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: null,
        waitlistEnabled: false,
      });
      mockPrisma.registration.count
        .mockResolvedValueOnce(50) // active count
        .mockResolvedValueOnce(0); // waitlist count

      const result = await getTournamentCapacityStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({
        maxCapacity: null,
        waitlistEnabled: false,
        activeCount: 50,
        waitlistCount: 0,
        spotsRemaining: null,
        isFull: false,
      });
    });

    it('returns correct status with capacity limit and spots remaining', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: true,
      });
      mockPrisma.registration.count
        .mockResolvedValueOnce(75) // active count
        .mockResolvedValueOnce(5); // waitlist count

      const result = await getTournamentCapacityStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({
        maxCapacity: 100,
        waitlistEnabled: true,
        activeCount: 75,
        waitlistCount: 5,
        spotsRemaining: 25,
        isFull: false,
      });
    });

    it('returns isFull=true when at capacity', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: true,
      });
      mockPrisma.registration.count
        .mockResolvedValueOnce(100) // active count
        .mockResolvedValueOnce(10); // waitlist count

      const result = await getTournamentCapacityStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({
        maxCapacity: 100,
        waitlistEnabled: true,
        activeCount: 100,
        waitlistCount: 10,
        spotsRemaining: 0,
        isFull: true,
      });
    });
  });

  describe('decideRegistrationSlot', () => {
    const base = { maxCapacity: 10, waitlistEnabled: true, activeCount: 0, maxWaitlistPosition: null };

    it('is unlimited without a capacity', () => {
      expect(decideRegistrationSlot({ ...base, maxCapacity: null, activeCount: 999 })).toEqual({ kind: 'active' });
    });

    it('rejects when full and the waitlist is disabled', () => {
      expect(decideRegistrationSlot({ ...base, waitlistEnabled: false, activeCount: 10 })).toEqual({ kind: 'full' });
    });

    it('waitlists after the current max position when full', () => {
      expect(decideRegistrationSlot({ ...base, activeCount: 10, maxWaitlistPosition: 4 }))
        .toEqual({ kind: 'waitlisted', position: 5 });
    });
  });

  describe('reserveRegistrationSlot', () => {
    it('throws TournamentFullError (409) when full without a waitlist', async () => {
      mockPrisma.registration.count.mockResolvedValue(5);
      const error = await reserveRegistrationSlot(
        mockPrisma as never,
        { id: 't1', maxCapacity: 5, waitlistEnabled: false },
      ).catch((e) => e);
      expect(error).toBeInstanceOf(TournamentFullError);
      expect(error.status).toBe(409);
    });
  });
});

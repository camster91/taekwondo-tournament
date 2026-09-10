import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkWaitlistStatus, getTournamentCapacityStatus } from './waitlist.js';

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

      expect(result).toEqual({ shouldWaitlist: false, position: null });
    });

    it('returns shouldWaitlist=false when waitlist is disabled', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        maxCapacity: 100,
        waitlistEnabled: false,
      });

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: false, position: null });
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

      expect(result).toEqual({ shouldWaitlist: false, position: null });
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

      expect(result).toEqual({ shouldWaitlist: true, position: 3 });
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

      expect(result).toEqual({ shouldWaitlist: true, position: 1 });
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
});

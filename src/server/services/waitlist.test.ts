import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkWaitlistStatus, promoteNextWaitlisted } from './waitlist.js';

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

describe('waitlist', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  describe('checkWaitlistStatus', () => {
    it('returns shouldWaitlist=false when no maxCompetitors is set', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        settings: '{}',
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
        settings: JSON.stringify({ maxCompetitors: 100 }),
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
        settings: JSON.stringify({ maxCompetitors: 100 }),
      });
      // 100 active + 2 waitlisted = position 3
      mockPrisma.registration.count
        .mockResolvedValueOnce(100) // active count
        .mockResolvedValueOnce(2); // waitlist count

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: true, position: 3 });
    });

    it('handles invalid JSON settings gracefully', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't1',
        settings: 'invalid json',
      });

      const result = await checkWaitlistStatus(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(result).toEqual({ shouldWaitlist: false, position: null });
    });
  });

  describe('promoteNextWaitlisted', () => {
    it('does nothing when no one is waitlisted', async () => {
      mockPrisma.registration.findFirst.mockResolvedValue(null);

      await promoteNextWaitlisted(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      expect(mockPrisma.registration.update).not.toHaveBeenCalled();
    });

    it('promotes the next waitlisted competitor and renumbers remaining', async () => {
      const nextWaitlisted = {
        id: 'reg1',
        tournamentId: 't1',
        waitlistStatus: 'waitlisted',
        waitlistPosition: 1,
        parentEmail: 'parent@example.com',
        managementTokenHash: 'hash123',
        competitor: {
          firstName: 'John',
          lastName: 'Doe',
        },
        tournament: {
          name: 'Test Tournament',
          date: new Date('2026-05-15'),
          brandName: null,
          organization: null,
        },
      };

      const remaining = [
        { id: 'reg2', waitlistPosition: 2 },
        { id: 'reg3', waitlistPosition: 3 },
      ];

      mockPrisma.registration.findFirst.mockResolvedValue(nextWaitlisted);
      mockPrisma.registration.findMany.mockResolvedValue(remaining);

      await promoteNextWaitlisted(
        mockPrisma as unknown as PrismaClient,
        't1'
      );

      // Should promote reg1 with a new management token hash
      const promoteCall = mockPrisma.registration.update.mock.calls.find(
        (call: any) => call[0].where.id === 'reg1'
      );
      expect(promoteCall).toBeDefined();
      expect(promoteCall[0].data).toMatchObject({
        waitlistStatus: 'active',
        waitlistPosition: null,
      });
      expect(promoteCall[0].data.managementTokenHash).toBeDefined();
      expect(typeof promoteCall[0].data.managementTokenHash).toBe('string');
      expect(promoteCall[0].data.managementTokenHash).not.toBe('hash123'); // New token

      // Should renumber remaining (reg2 → 1, reg3 → 2)
      expect(mockPrisma.registration.update).toHaveBeenCalledWith({
        where: { id: 'reg2' },
        data: { waitlistPosition: 1 },
      });
      expect(mockPrisma.registration.update).toHaveBeenCalledWith({
        where: { id: 'reg3' },
        data: { waitlistPosition: 2 },
      });
    });
  });
});

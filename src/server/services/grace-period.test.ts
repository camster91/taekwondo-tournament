import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { processExpiredGracePeriods, getOrganizationsInGracePeriod } from './grace-period.js';

// Simple mock setup without vitest-mock-extended
const createMockPrisma = () => {
  const mockPrisma = {
    organizationBillingSubscription: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      update: vi.fn(),
    },
    organizationPlanChange: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) => {
      return callback(mockPrisma);
    }),
  } as unknown as PrismaClient;
  return mockPrisma;
};

describe('processExpiredGracePeriods', () => {
  it('downgrades organizations with expired grace periods', async () => {
    const mockPrisma = createMockPrisma();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const expiredSubscription = {
      id: 'sub-1',
      organizationId: 'org-1',
      gracePeriodEndsAt: yesterday,
      paymentFailedAt: weekAgo,
      status: 'active',
      organization: {
        id: 'org-1',
        name: 'Test Org',
        plan: 'starter',
      },
    };

    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue([
      expiredSubscription,
    ] as any);

    const result = await processExpiredGracePeriods(mockPrisma);

    expect(result.downgraded).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('does not downgrade organizations without expired grace periods', async () => {
    const mockPrisma = createMockPrisma();
    
    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue([]);

    const result = await processExpiredGracePeriods(mockPrisma);

    expect(result.downgraded).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles errors gracefully and continues processing', async () => {
    const mockPrisma = createMockPrisma();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const subscriptions = [
      {
        id: 'sub-1',
        organizationId: 'org-1',
        gracePeriodEndsAt: yesterday,
        paymentFailedAt: yesterday,
        organization: { id: 'org-1', name: 'Test Org 1', plan: 'starter' },
      },
      {
        id: 'sub-2',
        organizationId: 'org-2',
        gracePeriodEndsAt: yesterday,
        paymentFailedAt: yesterday,
        organization: { id: 'org-2', name: 'Test Org 2', plan: 'pro' },
      },
    ];

    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue(
      subscriptions as any,
    );

    let callCount = 0;
    vi.spyOn(mockPrisma, '$transaction').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Database error');
      }
      return undefined;
    });

    const result = await processExpiredGracePeriods(mockPrisma);

    expect(result.downgraded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('org-1');
  });
});

describe('getOrganizationsInGracePeriod', () => {
  it('returns organizations in grace period with days remaining', async () => {
    const mockPrisma = createMockPrisma();
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const subscription = {
      organizationId: 'org-1',
      gracePeriodEndsAt: threeDaysFromNow,
      paymentFailedAt: fiveDaysAgo,
      organization: {
        id: 'org-1',
        name: 'Test Org',
      },
    };

    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue([
      subscription,
    ] as any);

    const result = await getOrganizationsInGracePeriod(mockPrisma);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      organizationId: 'org-1',
      organizationName: 'Test Org',
      paymentFailedAt: fiveDaysAgo,
      gracePeriodEndsAt: threeDaysFromNow,
    });
    expect(result[0].daysRemaining).toBeGreaterThanOrEqual(2);
    expect(result[0].daysRemaining).toBeLessThanOrEqual(4);
  });

  it('does not return organizations with expired grace periods', async () => {
    const mockPrisma = createMockPrisma();
    
    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue([]);

    const result = await getOrganizationsInGracePeriod(mockPrisma);

    expect(result).toHaveLength(0);
  });
});

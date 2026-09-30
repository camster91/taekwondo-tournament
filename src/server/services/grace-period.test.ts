import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { processExpiredGracePeriods, getOrganizationsInGracePeriod, startGracePeriodJob } from './grace-period.js';

// Simple mock setup without vitest-mock-extended
const createMockPrisma = () => {
  const mockPrisma = {
    organizationBillingSubscription: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      return true;
    });

    const result = await processExpiredGracePeriods(mockPrisma);

    expect(result.downgraded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('org-1');
  });
});

describe('processExpiredGracePeriods concurrency', () => {
  it('does not downgrade or record a plan change when another run already claimed the subscription', async () => {
    const mockPrisma = createMockPrisma();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue([{
      id: 'sub-1', organizationId: 'org-1', gracePeriodEndsAt: yesterday, paymentFailedAt: yesterday,
      organization: { id: 'org-1', name: 'Org', plan: 'pro' },
    }] as any);
    vi.mocked(mockPrisma.organizationBillingSubscription.updateMany).mockResolvedValue({ count: 0 } as any);

    const result = await processExpiredGracePeriods(mockPrisma);

    expect(result.downgraded).toBe(0);
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    expect(mockPrisma.organizationPlanChange.create).not.toHaveBeenCalled();
  });
});

describe('startGracePeriodJob', () => {
  it('runs once at startup and schedules an unref\'d repeat', async () => {
    const mockPrisma = createMockPrisma();
    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockResolvedValue([]);
    const unref = vi.fn();
    const schedule = vi.fn(() => ({ unref }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await startGracePeriodJob({ database: mockPrisma, intervalMs: 1000, schedule, logger });

    expect(mockPrisma.organizationBillingSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(unref).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and survives a failed run', async () => {
    const mockPrisma = createMockPrisma();
    vi.spyOn(mockPrisma.organizationBillingSubscription, 'findMany').mockRejectedValue(new Error('db down'));
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(startGracePeriodJob({
      database: mockPrisma, schedule: () => ({}), logger,
    })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('[grace-period] run failed', expect.any(Error));
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

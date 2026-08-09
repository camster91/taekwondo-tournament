import { describe, expect, it, vi } from 'vitest';
import { invalidateScheduleRecommendations } from './schedule-recommendation-invalidation';

describe('invalidateScheduleRecommendations', () => {
  it('marks every proposed or approved schedule optimization stale after an input mutation', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    await invalidateScheduleRecommendations({ recommendation: { updateMany } } as never, 't1', new Date('2026-08-09T15:00:00Z'));
    expect(updateMany).toHaveBeenCalledWith({
      where: { tournamentId: 't1', recommendationType: 'schedule_optimization_v1', status: { in: ['proposed', 'approved'] } },
      data: {
        status: 'rejected', rejectedBy: 'system:schedule-input-change', rejectedAt: new Date('2026-08-09T15:00:00Z'),
        rejectionReason: 'Schedule inputs changed; generate a fresh proposal.', approvedBy: null, approvedAt: null,
      },
    });
  });
});

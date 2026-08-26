import { describe, expect, it } from 'vitest';
import { getRecommendationValidator } from './recommendation-validators.js';

describe('recommendation validator registry', () => {
  it('registers deterministic server validators for division and schedule proposals', () => {
    expect(getRecommendationValidator('division_categorization_v1')).toBeTypeOf('function');
    expect(getRecommendationValidator('schedule_optimization_v1')).toBeTypeOf('function');
    expect(getRecommendationValidator('invented-client-type')).toBeUndefined();
  });
});

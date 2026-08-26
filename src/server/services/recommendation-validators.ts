import type { RecommendationValidator } from './recommendation-contract.js';
import { DIVISION_RECOMMENDATION_TYPE, validateDivisionRecommendation } from './division-recommendations.js';
import { SCHEDULE_OPTIMIZATION_TYPE, validateScheduleOptimizationRecommendation } from './schedule-optimization-recommendations.js';

const validators = new Map<string, RecommendationValidator>();
validators.set(DIVISION_RECOMMENDATION_TYPE, validateDivisionRecommendation);
validators.set(SCHEDULE_OPTIMIZATION_TYPE, validateScheduleOptimizationRecommendation);

export function registerRecommendationValidator(recommendationType: string, validator: RecommendationValidator): void {
  if (!recommendationType.trim()) throw new Error('Recommendation type is required');
  if (validators.has(recommendationType)) throw new Error(`Validator already registered for ${recommendationType}`);
  validators.set(recommendationType, validator);
}

export function getRecommendationValidator(recommendationType: string): RecommendationValidator | undefined {
  return validators.get(recommendationType);
}

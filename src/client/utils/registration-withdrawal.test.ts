import { describe, expect, it } from 'vitest';
import { classifyWithdrawalResponse } from './registration-withdrawal.js';

describe('registration withdrawal response', () => {
  it('never classifies not-found as a successful withdrawal', () => {
    expect(classifyWithdrawalResponse(404)).toEqual({ outcome: 'unavailable', message: 'Already withdrawn or not found.' });
  });

  it('reserves withdrawn confirmation for a successful response', () => {
    expect(classifyWithdrawalResponse(204)).toEqual({ outcome: 'withdrawn' });
    expect(classifyWithdrawalResponse(409)).toEqual({ outcome: 'conflict' });
    expect(classifyWithdrawalResponse(500)).toEqual({ outcome: 'failure' });
  });
});

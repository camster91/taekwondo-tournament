export type WithdrawalOutcome =
  | { outcome: 'withdrawn' }
  | { outcome: 'unavailable'; message: string }
  | { outcome: 'conflict' }
  | { outcome: 'failure' };

export function classifyWithdrawalResponse(status: number): WithdrawalOutcome {
  if (status >= 200 && status < 300) return { outcome: 'withdrawn' };
  if (status === 404) return { outcome: 'unavailable', message: 'Already withdrawn or not found.' };
  if (status === 409) return { outcome: 'conflict' };
  return { outcome: 'failure' };
}

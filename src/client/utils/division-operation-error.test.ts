import { describe, expect, it } from 'vitest';
import {
  DivisionOperationError,
  describeForcedDataLoss,
  divisionErrorMessage,
  isForceConfirmable,
  readDivisionOperationError,
} from './division-operation-error';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('division operation errors', () => {
  it('reads the 409 data-loss refusal and allows a forced retry', async () => {
    const error = await readDivisionOperationError(jsonResponse(409, {
      error: 'Operation would cause data loss',
      code: 'DATA_LOSS_WARNING',
      warning: 'This will delete 3 existing bracket(s). Match results will be lost.',
      affectedItems: 3,
    }), 'Failed');
    expect(isForceConfirmable(error)).toBe(true);
    expect(error.affectedItems).toBe(3);
    expect(describeForcedDataLoss(error, 'Regenerate divisions')).toContain('This will delete 3 existing bracket(s)');
    expect(describeForcedDataLoss(error, 'Regenerate divisions')).toContain('Regenerate divisions anyway?');
  });

  it('treats DIVISION_HAS_RESULTS as force-confirmable', async () => {
    const error = await readDivisionOperationError(jsonResponse(409, { error: 'Division has match results', code: 'DIVISION_HAS_RESULTS' }), 'Failed');
    expect(isForceConfirmable(error)).toBe(true);
    expect(describeForcedDataLoss(error, 'Delete the division')).toContain('Division has match results');
  });

  it('does not offer force for other failures', async () => {
    const forbidden = await readDivisionOperationError(jsonResponse(403, { error: 'Insufficient permissions' }), 'Failed');
    const activeBrackets = await readDivisionOperationError(jsonResponse(409, { error: 'Brackets running', code: 'ACTIVE_BRACKETS' }), 'Failed');
    expect(isForceConfirmable(forbidden)).toBe(false);
    expect(isForceConfirmable(activeBrackets)).toBe(false);
    expect(isForceConfirmable(new Error('x'))).toBe(false);
    expect(divisionErrorMessage(forbidden, 'Failed')).toBe('Insufficient permissions');
  });

  it('falls back when the body is not JSON', async () => {
    const error = await readDivisionOperationError(new Response('oops', { status: 500 }), 'Failed to clear divisions');
    expect(error).toBeInstanceOf(DivisionOperationError);
    expect(error.message).toBe('Failed to clear divisions');
    expect(divisionErrorMessage('weird', 'Fallback')).toBe('Fallback');
  });
});

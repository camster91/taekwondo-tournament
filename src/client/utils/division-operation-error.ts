/**
 * Errors from destructive division operations (auto-generate/regenerate,
 * clear all, delete one). The server answers 409 with a `code` when the
 * operation would destroy brackets or results and accepts a force flag
 * to proceed; the UI must show that warning and ask again instead of
 * silently doing nothing.
 */
export const FORCE_CONFIRMABLE_CODES = ['DATA_LOSS_WARNING', 'DIVISION_HAS_RESULTS'] as const;

export class DivisionOperationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly warning?: string,
    public readonly affectedItems?: number,
  ) {
    super(message);
    this.name = 'DivisionOperationError';
  }
}

export async function readDivisionOperationError(res: Response, fallback: string): Promise<DivisionOperationError> {
  let body: { error?: unknown; message?: unknown; code?: unknown; warning?: unknown; affectedItems?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error body: fall back to the generic message.
  }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
  return new DivisionOperationError(
    text(body.error) ?? text(body.message) ?? fallback,
    res.status,
    text(body.code),
    text(body.warning),
    typeof body.affectedItems === 'number' ? body.affectedItems : undefined,
  );
}

/** True when the server refused only because data would be lost and a forced retry is allowed. */
export function isForceConfirmable(error: unknown): error is DivisionOperationError {
  return error instanceof DivisionOperationError
    && error.status === 409
    && (FORCE_CONFIRMABLE_CODES as readonly string[]).includes(error.code ?? '');
}

/** Message for the second, explicit confirmation before a forced retry. */
export function describeForcedDataLoss(error: DivisionOperationError, action: string): string {
  const detail = error.warning || error.message;
  return `${detail}\n\n${action} anyway? This permanently removes that data.`;
}

export function divisionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DivisionOperationError) return error.warning ? `${error.message}: ${error.warning}` : error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

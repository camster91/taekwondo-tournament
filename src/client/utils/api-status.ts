export type ApiFailureKind = 'not_found' | 'rate_limited' | 'unauthenticated' | 'forbidden' | 'validation' | 'conflict' | 'unavailable';

export class ApiFailure extends Error {
  constructor(
    message: string,
    public readonly kind: ApiFailureKind,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

function classify(status: number): { kind: ApiFailureKind; retryable: boolean } {
  if (status === 404) return { kind: 'not_found', retryable: false };
  if (status === 429) return { kind: 'rate_limited', retryable: true };
  if (status === 401) return { kind: 'unauthenticated', retryable: false };
  if (status === 403) return { kind: 'forbidden', retryable: false };
  if (status === 409) return { kind: 'conflict', retryable: false };
  if (status === 400 || status === 422) return { kind: 'validation', retryable: false };
  return { kind: 'unavailable', retryable: status >= 500 || status === 408 };
}

export async function fetchJson<T>(request: RequestLike, input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await request(input, init);
  } catch {
    throw new ApiFailure('The service could not be reached.', 'unavailable', true);
  }
  let body: { error?: string; details?: unknown } | T | null;
  try {
    body = await response.json() as { error?: string; details?: unknown } | T;
  } catch {
    if (response.ok) {
      throw new ApiFailure('The service returned an invalid response.', 'unavailable', true, response.status);
    }
    body = null;
  }
  if (!response.ok) {
    const classification = classify(response.status);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${response.status})`;
    const details = body && typeof body === 'object' && 'details' in body && Array.isArray(body.details)
      && body.details.every((detail) => typeof detail === 'string')
      ? body.details
      : undefined;
    throw new ApiFailure(message, classification.kind, classification.retryable, response.status, retryAfterSeconds(response), details);
  }
  return body as T;
}

export function getApiFailure(error: unknown): ApiFailure | null {
  return error instanceof ApiFailure ? error : null;
}

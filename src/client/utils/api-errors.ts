// Client-side API error handling utilities

export interface ApiErrorResponse {
  error: string;
  code?: string;
  recoverable?: boolean;
  suggestion?: string;
  details?: any[];
}

/**
 * Parse API error response into user-friendly format
 */
export function parseApiError(error: unknown): ApiErrorResponse {
  // Handle fetch errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      error: 'Unable to connect to server',
      code: 'NETWORK_ERROR',
      recoverable: true,
      suggestion: 'Check your internet connection and try again',
    };
  }

  // Handle response errors
  if (error && typeof error === 'object') {
    const err = error as ApiErrorResponse;
    return {
      error: err.error || 'An unexpected error occurred',
      code: err.code,
      recoverable: err.recoverable ?? true,
      suggestion: err.suggestion,
      details: err.details,
    };
  }

  // Default error
  return {
    error: 'An unexpected error occurred',
    recoverable: false,
  };
}

/**
 * Make API request with error handling
 */
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const response = await fetch(url, { ...defaultOptions, ...options });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw errorData;
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;

  return JSON.parse(text);
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(
  details: Array<{ field: string; message: string }>
): string {
  if (!details || details.length === 0) return '';

  return details
    .map((d) => `• ${d.field}: ${d.message}`)
    .join('\n');
}

/**
 * Get error display config for toast/modal
 */
export function getErrorDisplayConfig(error: ApiErrorResponse): {
  title: string;
  message: string;
  type: 'error' | 'warning';
  showRetry: boolean;
} {
  const isWarning = error.recoverable && error.code !== 'VALIDATION_ERROR';

  return {
    title: isWarning ? 'Warning' : 'Error',
    message: error.suggestion
      ? `${error.error}\n\n${error.suggestion}`
      : error.error,
    type: isWarning ? 'warning' : 'error',
    showRetry: error.recoverable ?? false,
  };
}

/**
 * Common error messages for known error codes
 */
export const ERROR_MESSAGES: Record<string, string> = {
  TOURNAMENT_NOT_FOUND: 'This tournament no longer exists',
  COMPETITOR_NOT_FOUND: 'This competitor was not found',
  COMPETITOR_ALREADY_REGISTERED: 'This competitor is already registered',
  DIVISION_HAS_BRACKET: 'Cannot modify - division has a bracket',
  BRACKET_IN_PROGRESS: 'Cannot modify - matches in progress',
  NO_REGISTRATIONS: 'No competitors registered yet',
  VALIDATION_ERROR: 'Please check your input',
  NETWORK_ERROR: 'Connection error - please retry',
  TIMEOUT_ERROR: 'Request timed out - try with fewer items',
};

/**
 * Get user-friendly message for error code
 */
export function getUserFriendlyMessage(code?: string): string | undefined {
  if (!code) return undefined;
  return ERROR_MESSAGES[code];
}

// Centralized error handling utilities

export enum ErrorCode {
  // General errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Tournament errors
  TOURNAMENT_NOT_FOUND = 'TOURNAMENT_NOT_FOUND',
  TOURNAMENT_LOCKED = 'TOURNAMENT_LOCKED',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',

  // Competitor errors
  COMPETITOR_NOT_FOUND = 'COMPETITOR_NOT_FOUND',
  COMPETITOR_ALREADY_REGISTERED = 'COMPETITOR_ALREADY_REGISTERED',

  // Division errors
  DIVISION_NOT_FOUND = 'DIVISION_NOT_FOUND',
  DIVISION_HAS_BRACKET = 'DIVISION_HAS_BRACKET',
  NO_REGISTRATIONS = 'NO_REGISTRATIONS',

  // Bracket errors
  BRACKET_NOT_FOUND = 'BRACKET_NOT_FOUND',
  BRACKET_ALREADY_EXISTS = 'BRACKET_ALREADY_EXISTS',
  BRACKET_IN_PROGRESS = 'BRACKET_IN_PROGRESS',
  INVALID_MATCH_UPDATE = 'INVALID_MATCH_UPDATE',

  // Import errors
  IMPORT_FAILED = 'IMPORT_FAILED',
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',

  // System errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ApiError {
  error: string;           // Human-readable message
  code: ErrorCode;         // Machine-readable code
  details?: any[];         // Additional details (validation errors, etc.)
  recoverable: boolean;    // Can the user fix this?
  suggestion?: string;     // What should the user try?
  statusCode: number;      // HTTP status code
}

/**
 * Application-specific error class
 */
export class AppError extends Error {
  public code: ErrorCode;
  public statusCode: number;
  public recoverable: boolean;
  public suggestion?: string;
  public details?: any[];

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 400,
    options: {
      recoverable?: boolean;
      suggestion?: string;
      details?: any[];
    } = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.recoverable = options.recoverable ?? true;
    this.suggestion = options.suggestion;
    this.details = options.details;
  }

  toJSON(): ApiError {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      details: this.details,
    };
  }
}

// Common error factories
export const Errors = {
  notFound: (resource: string, id?: string) =>
    new AppError(
      id ? `${resource} with ID "${id}" not found` : `${resource} not found`,
      ErrorCode.NOT_FOUND,
      404,
      { recoverable: false }
    ),

  tournamentNotFound: (id: string) =>
    new AppError(
      `Tournament not found`,
      ErrorCode.TOURNAMENT_NOT_FOUND,
      404,
      { recoverable: false }
    ),

  competitorNotFound: (id: string) =>
    new AppError(
      `Competitor not found`,
      ErrorCode.COMPETITOR_NOT_FOUND,
      404,
      { recoverable: false }
    ),

  divisionNotFound: (id: string) =>
    new AppError(
      `Division not found`,
      ErrorCode.DIVISION_NOT_FOUND,
      404,
      { recoverable: false }
    ),

  bracketNotFound: (id: string) =>
    new AppError(
      `Bracket not found`,
      ErrorCode.BRACKET_NOT_FOUND,
      404,
      { recoverable: false }
    ),

  alreadyRegistered: (competitorName: string, tournamentName: string) =>
    new AppError(
      `${competitorName} is already registered for ${tournamentName}`,
      ErrorCode.COMPETITOR_ALREADY_REGISTERED,
      409,
      {
        recoverable: true,
        suggestion: 'Update the existing registration instead',
      }
    ),

  divisionHasBracket: (divisionName: string) =>
    new AppError(
      `Cannot modify division "${divisionName}" because it already has a bracket`,
      ErrorCode.DIVISION_HAS_BRACKET,
      409,
      {
        recoverable: true,
        suggestion: 'Delete the bracket first, then modify the division',
      }
    ),

  bracketInProgress: (divisionName: string) =>
    new AppError(
      `Cannot modify bracket for "${divisionName}" because matches are in progress`,
      ErrorCode.BRACKET_IN_PROGRESS,
      409,
      {
        recoverable: false,
        suggestion: 'Complete or reset the bracket before making changes',
      }
    ),

  noRegistrations: (tournamentName: string) =>
    new AppError(
      `Cannot generate divisions: no registrations found for "${tournamentName}"`,
      ErrorCode.NO_REGISTRATIONS,
      400,
      {
        recoverable: true,
        suggestion: 'Register competitors before generating divisions',
      }
    ),

  invalidStatusTransition: (from: string, to: string) =>
    new AppError(
      `Cannot change tournament status from "${from}" to "${to}"`,
      ErrorCode.INVALID_STATUS_TRANSITION,
      400,
      { recoverable: true }
    ),

  validationFailed: (details: any[]) =>
    new AppError(
      'Validation failed',
      ErrorCode.VALIDATION_ERROR,
      400,
      { recoverable: true, details }
    ),

  importFailed: (errors: Array<{ row: number; message: string }>) =>
    new AppError(
      `Import completed with ${errors.length} error(s)`,
      ErrorCode.IMPORT_FAILED,
      207, // Multi-status
      {
        recoverable: true,
        details: errors,
        suggestion: 'Review the errors and fix the source data',
      }
    ),

  timeout: (operation: string) =>
    new AppError(
      `Operation "${operation}" timed out`,
      ErrorCode.TIMEOUT_ERROR,
      504,
      {
        recoverable: true,
        suggestion: 'Try again with fewer items or wait and retry',
      }
    ),

  internal: (message: string = 'An unexpected error occurred') =>
    new AppError(
      message,
      ErrorCode.INTERNAL_ERROR,
      500,
      { recoverable: false }
    ),
};

/**
 * Wrap async route handlers to catch errors
 */
export function asyncHandler(
  fn: (req: any, res: any, next: any) => Promise<any>
) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert unknown error to ApiError format
 */
export function toApiError(error: unknown): ApiError {
  if (isAppError(error)) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    // Handle Prisma errors
    if (error.message.includes('Unique constraint failed')) {
      return {
        error: 'A record with this data already exists',
        code: ErrorCode.DUPLICATE_ENTRY,
        statusCode: 409,
        recoverable: true,
        suggestion: 'Check for duplicates and try again',
      };
    }

    if (error.message.includes('Foreign key constraint failed')) {
      return {
        error: 'Referenced record not found',
        code: ErrorCode.NOT_FOUND,
        statusCode: 400,
        recoverable: true,
        suggestion: 'Make sure all referenced items exist',
      };
    }

    if (error.message.includes('timed out')) {
      return {
        error: 'The operation took too long',
        code: ErrorCode.TIMEOUT_ERROR,
        statusCode: 504,
        recoverable: true,
        suggestion: 'Try again with fewer items',
      };
    }
  }

  // Default unknown error
  return {
    error: 'An unexpected error occurred',
    code: ErrorCode.INTERNAL_ERROR,
    statusCode: 500,
    recoverable: false,
  };
}

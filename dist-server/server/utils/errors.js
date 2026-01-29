// Centralized error handling utilities
export var ErrorCode;
(function (ErrorCode) {
    // General errors
    ErrorCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorCode["NOT_FOUND"] = "NOT_FOUND";
    ErrorCode["DUPLICATE_ENTRY"] = "DUPLICATE_ENTRY";
    ErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCode["FORBIDDEN"] = "FORBIDDEN";
    // Tournament errors
    ErrorCode["TOURNAMENT_NOT_FOUND"] = "TOURNAMENT_NOT_FOUND";
    ErrorCode["TOURNAMENT_LOCKED"] = "TOURNAMENT_LOCKED";
    ErrorCode["INVALID_STATUS_TRANSITION"] = "INVALID_STATUS_TRANSITION";
    // Competitor errors
    ErrorCode["COMPETITOR_NOT_FOUND"] = "COMPETITOR_NOT_FOUND";
    ErrorCode["COMPETITOR_ALREADY_REGISTERED"] = "COMPETITOR_ALREADY_REGISTERED";
    // Division errors
    ErrorCode["DIVISION_NOT_FOUND"] = "DIVISION_NOT_FOUND";
    ErrorCode["DIVISION_HAS_BRACKET"] = "DIVISION_HAS_BRACKET";
    ErrorCode["NO_REGISTRATIONS"] = "NO_REGISTRATIONS";
    // Bracket errors
    ErrorCode["BRACKET_NOT_FOUND"] = "BRACKET_NOT_FOUND";
    ErrorCode["BRACKET_ALREADY_EXISTS"] = "BRACKET_ALREADY_EXISTS";
    ErrorCode["BRACKET_IN_PROGRESS"] = "BRACKET_IN_PROGRESS";
    ErrorCode["INVALID_MATCH_UPDATE"] = "INVALID_MATCH_UPDATE";
    // Import errors
    ErrorCode["IMPORT_FAILED"] = "IMPORT_FAILED";
    ErrorCode["INVALID_FILE_FORMAT"] = "INVALID_FILE_FORMAT";
    // System errors
    ErrorCode["DATABASE_ERROR"] = "DATABASE_ERROR";
    ErrorCode["TIMEOUT_ERROR"] = "TIMEOUT_ERROR";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ErrorCode || (ErrorCode = {}));
/**
 * Application-specific error class
 */
export class AppError extends Error {
    code;
    statusCode;
    recoverable;
    suggestion;
    details;
    constructor(message, code, statusCode = 400, options = {}) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.statusCode = statusCode;
        this.recoverable = options.recoverable ?? true;
        this.suggestion = options.suggestion;
        this.details = options.details;
    }
    toJSON() {
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
    notFound: (resource, id) => new AppError(id ? `${resource} with ID "${id}" not found` : `${resource} not found`, ErrorCode.NOT_FOUND, 404, { recoverable: false }),
    tournamentNotFound: (id) => new AppError(`Tournament not found`, ErrorCode.TOURNAMENT_NOT_FOUND, 404, { recoverable: false }),
    competitorNotFound: (id) => new AppError(`Competitor not found`, ErrorCode.COMPETITOR_NOT_FOUND, 404, { recoverable: false }),
    divisionNotFound: (id) => new AppError(`Division not found`, ErrorCode.DIVISION_NOT_FOUND, 404, { recoverable: false }),
    bracketNotFound: (id) => new AppError(`Bracket not found`, ErrorCode.BRACKET_NOT_FOUND, 404, { recoverable: false }),
    alreadyRegistered: (competitorName, tournamentName) => new AppError(`${competitorName} is already registered for ${tournamentName}`, ErrorCode.COMPETITOR_ALREADY_REGISTERED, 409, {
        recoverable: true,
        suggestion: 'Update the existing registration instead',
    }),
    divisionHasBracket: (divisionName) => new AppError(`Cannot modify division "${divisionName}" because it already has a bracket`, ErrorCode.DIVISION_HAS_BRACKET, 409, {
        recoverable: true,
        suggestion: 'Delete the bracket first, then modify the division',
    }),
    bracketInProgress: (divisionName) => new AppError(`Cannot modify bracket for "${divisionName}" because matches are in progress`, ErrorCode.BRACKET_IN_PROGRESS, 409, {
        recoverable: false,
        suggestion: 'Complete or reset the bracket before making changes',
    }),
    noRegistrations: (tournamentName) => new AppError(`Cannot generate divisions: no registrations found for "${tournamentName}"`, ErrorCode.NO_REGISTRATIONS, 400, {
        recoverable: true,
        suggestion: 'Register competitors before generating divisions',
    }),
    invalidStatusTransition: (from, to) => new AppError(`Cannot change tournament status from "${from}" to "${to}"`, ErrorCode.INVALID_STATUS_TRANSITION, 400, { recoverable: true }),
    validationFailed: (details) => new AppError('Validation failed', ErrorCode.VALIDATION_ERROR, 400, { recoverable: true, details }),
    importFailed: (errors) => new AppError(`Import completed with ${errors.length} error(s)`, ErrorCode.IMPORT_FAILED, 207, // Multi-status
    {
        recoverable: true,
        details: errors,
        suggestion: 'Review the errors and fix the source data',
    }),
    timeout: (operation) => new AppError(`Operation "${operation}" timed out`, ErrorCode.TIMEOUT_ERROR, 504, {
        recoverable: true,
        suggestion: 'Try again with fewer items or wait and retry',
    }),
    internal: (message = 'An unexpected error occurred') => new AppError(message, ErrorCode.INTERNAL_ERROR, 500, { recoverable: false }),
};
/**
 * Wrap async route handlers to catch errors
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
/**
 * Check if error is an AppError
 */
export function isAppError(error) {
    return error instanceof AppError;
}
/**
 * Convert unknown error to ApiError format
 */
export function toApiError(error) {
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

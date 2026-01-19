/**
 * API Error Classes
 *
 * Sprint 122: Optimistic Locking
 *
 * Standardized error classes for API responses. Includes error codes,
 * HTTP status codes, and error-specific details for client retry logic.
 *
 * @see grimoires/loa/sdd.md §4.2 Error Handling
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base API error with HTTP status code
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }

  toJSON() {
    return {
      error: this.errorCode,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

// =============================================================================
// 4xx Client Errors
// =============================================================================

/**
 * 400 Bad Request
 */
export class BadRequestError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'BAD_REQUEST', details);
    this.name = 'BadRequestError';
  }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * 403 Forbidden
 */
export class ForbiddenError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 403, 'FORBIDDEN', details);
    this.name = 'ForbiddenError';
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends ApiError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict - Version Conflict Error
 *
 * Sprint 122: Optimistic Locking
 *
 * Returned when a client's expectedVersion doesn't match the server's
 * current version, indicating a concurrent edit conflict.
 */
export class ConflictError extends ApiError {
  /** Current version on the server */
  public readonly currentVersion: number;
  /** Version the client expected */
  public readonly yourVersion: number;
  /** Server ID affected */
  public readonly serverId: string;
  /** When the resource was last updated */
  public readonly updatedAt: Date;

  constructor(
    serverId: string,
    currentVersion: number,
    yourVersion: number,
    updatedAt: Date = new Date()
  ) {
    super(
      `Version conflict: you provided version ${yourVersion}, but current version is ${currentVersion}. Please refresh and retry.`,
      409,
      'VERSION_CONFLICT',
      {
        serverId,
        currentVersion,
        yourVersion,
        updatedAt: updatedAt.toISOString(),
      }
    );
    this.name = 'ConflictError';
    this.serverId = serverId;
    this.currentVersion = currentVersion;
    this.yourVersion = yourVersion;
    this.updatedAt = updatedAt;
  }

  /**
   * Create from OptimisticLockError thrown by ConfigService
   */
  static fromOptimisticLockError(
    serverId: string,
    expectedVersion: number,
    actualVersion: number,
    updatedAt?: Date
  ): ConflictError {
    return new ConflictError(serverId, actualVersion, expectedVersion, updatedAt);
  }
}

/**
 * 422 Unprocessable Entity - Validation Error
 */
export class ValidationError extends ApiError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(fieldErrors: Record<string, string[]>) {
    const errorCount = Object.values(fieldErrors).flat().length;
    super(
      `Validation failed with ${errorCount} error(s)`,
      422,
      'VALIDATION_ERROR',
      { fields: fieldErrors }
    );
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }

  static fromZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): ValidationError {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_root';
      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    }
    return new ValidationError(fieldErrors);
  }
}

// =============================================================================
// 5xx Server Errors
// =============================================================================

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends ApiError {
  constructor(message: string = 'An unexpected error occurred') {
    super(message, 500, 'INTERNAL_ERROR');
    this.name = 'InternalServerError';
  }
}

/**
 * 503 Service Unavailable
 */
export class ServiceUnavailableError extends ApiError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Service temporarily unavailable', retryAfter?: number) {
    super(message, 503, 'SERVICE_UNAVAILABLE', retryAfter ? { retryAfter } : undefined);
    this.name = 'ServiceUnavailableError';
    this.retryAfter = retryAfter;
  }
}

// =============================================================================
// Error Handler Utility
// =============================================================================

/**
 * Check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Convert any error to an ApiError for consistent response format
 */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (error instanceof Error) {
    // Handle known error types from ConfigService
    if (error.name === 'OptimisticLockError') {
      // Parse version numbers from error message
      const match = error.message.match(/expected (\d+), got (\d+)/);
      if (match && match[1] && match[2]) {
        const expected = parseInt(match[1], 10);
        const actual = parseInt(match[2], 10);
        const serverMatch = error.message.match(/server ([a-zA-Z0-9-]+)/);
        const serverId = serverMatch?.[1] ?? 'unknown';
        return new ConflictError(serverId, actual, expected);
      }
    }

    if (error.name === 'ConfigNotFoundError') {
      const match = error.message.match(/server ([a-zA-Z0-9-]+)/);
      return new NotFoundError('Configuration', match?.[1]);
    }

    return new InternalServerError(error.message);
  }

  return new InternalServerError('An unexpected error occurred');
}

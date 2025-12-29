/**
 * ApiError - Unified Error Response Format
 *
 * Sprint 51: High Priority Hardening (P1) - Observability & Session Security
 *
 * Standardizes error responses across all API endpoints with:
 * - Consistent error codes
 * - Human-readable messages
 * - Machine-readable error types
 * - Optional debug information (dev only)
 * - HTTP status code mapping
 *
 * @module packages/core/errors/ApiError
 */

import { createChildLogger } from '../../../utils/logger.js';

// Logger for error handler middleware
const logger = createChildLogger({ module: 'ApiError' });

/**
 * Standard API error codes
 */
export enum ApiErrorCode {
  // Authentication & Authorization (1xxx)
  UNAUTHORIZED = 'ERR_UNAUTHORIZED',
  FORBIDDEN = 'ERR_FORBIDDEN',
  SESSION_EXPIRED = 'ERR_SESSION_EXPIRED',
  INVALID_TOKEN = 'ERR_INVALID_TOKEN',
  RATE_LIMITED = 'ERR_RATE_LIMITED',
  IP_MISMATCH = 'ERR_IP_MISMATCH',
  DEVICE_MISMATCH = 'ERR_DEVICE_MISMATCH',

  // Validation Errors (2xxx)
  VALIDATION_ERROR = 'ERR_VALIDATION',
  INVALID_INPUT = 'ERR_INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'ERR_MISSING_FIELD',
  INVALID_FORMAT = 'ERR_INVALID_FORMAT',
  INVALID_RANGE = 'ERR_INVALID_RANGE',

  // Resource Errors (3xxx)
  NOT_FOUND = 'ERR_NOT_FOUND',
  ALREADY_EXISTS = 'ERR_ALREADY_EXISTS',
  CONFLICT = 'ERR_CONFLICT',
  GONE = 'ERR_GONE',

  // Business Logic Errors (4xxx)
  INSUFFICIENT_BALANCE = 'ERR_INSUFFICIENT_BALANCE',
  ELIGIBILITY_FAILED = 'ERR_ELIGIBILITY_FAILED',
  TIER_NOT_FOUND = 'ERR_TIER_NOT_FOUND',
  BADGE_NOT_EARNED = 'ERR_BADGE_NOT_EARNED',
  QUOTA_EXCEEDED = 'ERR_QUOTA_EXCEEDED',

  // External Service Errors (5xxx)
  EXTERNAL_SERVICE_ERROR = 'ERR_EXTERNAL_SERVICE',
  CHAIN_PROVIDER_ERROR = 'ERR_CHAIN_PROVIDER',
  SCORE_SERVICE_UNAVAILABLE = 'ERR_SCORE_SERVICE_UNAVAILABLE',
  DISCORD_API_ERROR = 'ERR_DISCORD_API',
  DATABASE_ERROR = 'ERR_DATABASE',
  CACHE_ERROR = 'ERR_CACHE',

  // Circuit Breaker Errors (6xxx)
  CIRCUIT_BREAKER_OPEN = 'ERR_CIRCUIT_BREAKER_OPEN',
  SERVICE_DEGRADED = 'ERR_SERVICE_DEGRADED',
  TIMEOUT = 'ERR_TIMEOUT',

  // Internal Server Errors (9xxx)
  INTERNAL_ERROR = 'ERR_INTERNAL',
  NOT_IMPLEMENTED = 'ERR_NOT_IMPLEMENTED',
  CONFIGURATION_ERROR = 'ERR_CONFIGURATION',
}

/**
 * HTTP status code mapping for error codes
 */
export const HTTP_STATUS_MAP: Record<ApiErrorCode, number> = {
  // 401 Unauthorized
  [ApiErrorCode.UNAUTHORIZED]: 401,
  [ApiErrorCode.SESSION_EXPIRED]: 401,
  [ApiErrorCode.INVALID_TOKEN]: 401,

  // 403 Forbidden
  [ApiErrorCode.FORBIDDEN]: 403,
  [ApiErrorCode.RATE_LIMITED]: 429,
  [ApiErrorCode.IP_MISMATCH]: 403,
  [ApiErrorCode.DEVICE_MISMATCH]: 403,

  // 400 Bad Request
  [ApiErrorCode.VALIDATION_ERROR]: 400,
  [ApiErrorCode.INVALID_INPUT]: 400,
  [ApiErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ApiErrorCode.INVALID_FORMAT]: 400,
  [ApiErrorCode.INVALID_RANGE]: 400,

  // 404 Not Found
  [ApiErrorCode.NOT_FOUND]: 404,

  // 409 Conflict
  [ApiErrorCode.ALREADY_EXISTS]: 409,
  [ApiErrorCode.CONFLICT]: 409,

  // 410 Gone
  [ApiErrorCode.GONE]: 410,

  // 422 Unprocessable Entity
  [ApiErrorCode.INSUFFICIENT_BALANCE]: 422,
  [ApiErrorCode.ELIGIBILITY_FAILED]: 422,
  [ApiErrorCode.TIER_NOT_FOUND]: 422,
  [ApiErrorCode.BADGE_NOT_EARNED]: 422,
  [ApiErrorCode.QUOTA_EXCEEDED]: 422,

  // 502 Bad Gateway
  [ApiErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ApiErrorCode.CHAIN_PROVIDER_ERROR]: 502,
  [ApiErrorCode.SCORE_SERVICE_UNAVAILABLE]: 503,
  [ApiErrorCode.DISCORD_API_ERROR]: 502,

  // 503 Service Unavailable
  [ApiErrorCode.CIRCUIT_BREAKER_OPEN]: 503,
  [ApiErrorCode.SERVICE_DEGRADED]: 503,
  [ApiErrorCode.TIMEOUT]: 504,

  // 500 Internal Server Error
  [ApiErrorCode.DATABASE_ERROR]: 500,
  [ApiErrorCode.CACHE_ERROR]: 500,
  [ApiErrorCode.INTERNAL_ERROR]: 500,
  [ApiErrorCode.NOT_IMPLEMENTED]: 501,
  [ApiErrorCode.CONFIGURATION_ERROR]: 500,
};

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Low severity - expected errors (validation, not found) */
  LOW = 'low',
  /** Medium severity - business logic errors */
  MEDIUM = 'medium',
  /** High severity - external service failures */
  HIGH = 'high',
  /** Critical severity - internal server errors */
  CRITICAL = 'critical',
}

/**
 * ApiError metadata
 */
export interface ApiErrorMetadata {
  /** Error code for machine-readable identification */
  code: ApiErrorCode;
  /** Human-readable error message */
  message: string;
  /** HTTP status code */
  statusCode: number;
  /** Error severity */
  severity: ErrorSeverity;
  /** Timestamp of error */
  timestamp: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Additional context (field names, validation details, etc.) */
  details?: Record<string, unknown>;
  /** Stack trace (only in development) */
  stack?: string;
  /** Original error (for wrapping) */
  cause?: Error;
}

/**
 * ApiError - Unified error class for consistent API responses
 *
 * Usage:
 * ```typescript
 * throw new ApiError(
 *   ApiErrorCode.NOT_FOUND,
 *   'User not found',
 *   { userId: '12345' }
 * );
 * ```
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly timestamp: string;
  public readonly requestId?: string;
  public readonly details?: Record<string, unknown>;
  public readonly originalCause?: Error;

  constructor(
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = HTTP_STATUS_MAP[code] ?? 500;
    this.severity = this.determineSeverity(code);
    this.timestamp = new Date().toISOString();
    this.details = details;
    this.originalCause = cause;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Determine error severity based on error code
   */
  private determineSeverity(code: ApiErrorCode): ErrorSeverity {
    // Validation and not found errors are low severity
    if (
      code.startsWith('ERR_VALIDATION') ||
      code === ApiErrorCode.NOT_FOUND ||
      code === ApiErrorCode.INVALID_INPUT ||
      code === ApiErrorCode.MISSING_REQUIRED_FIELD
    ) {
      return ErrorSeverity.LOW;
    }

    // Business logic errors are medium severity
    if (
      code === ApiErrorCode.INSUFFICIENT_BALANCE ||
      code === ApiErrorCode.ELIGIBILITY_FAILED ||
      code === ApiErrorCode.QUOTA_EXCEEDED
    ) {
      return ErrorSeverity.MEDIUM;
    }

    // External service and circuit breaker errors are high severity
    if (
      code === ApiErrorCode.EXTERNAL_SERVICE_ERROR ||
      code === ApiErrorCode.CHAIN_PROVIDER_ERROR ||
      code === ApiErrorCode.SCORE_SERVICE_UNAVAILABLE ||
      code === ApiErrorCode.CIRCUIT_BREAKER_OPEN ||
      code === ApiErrorCode.SERVICE_DEGRADED
    ) {
      return ErrorSeverity.HIGH;
    }

    // Internal errors are critical severity
    if (
      code === ApiErrorCode.INTERNAL_ERROR ||
      code === ApiErrorCode.DATABASE_ERROR ||
      code === ApiErrorCode.CONFIGURATION_ERROR
    ) {
      return ErrorSeverity.CRITICAL;
    }

    return ErrorSeverity.MEDIUM;
  }

  /**
   * Convert to JSON-serializable object for API response
   */
  toJSON(includeStack = false): ApiErrorMetadata {
    const error: ApiErrorMetadata = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      severity: this.severity,
      timestamp: this.timestamp,
    };

    if (this.requestId) {
      error.requestId = this.requestId;
    }

    if (this.details) {
      error.details = this.details;
    }

    if (includeStack && this.stack) {
      error.stack = this.stack;
    }

    return error;
  }

  /**
   * Set request ID for tracing
   */
  setRequestId(requestId: string): this {
    (this as { requestId?: string }).requestId = requestId;
    return this;
  }

  /**
   * Create ApiError from unknown error
   */
  static fromError(error: unknown, defaultMessage = 'An error occurred'): ApiError {
    if (error instanceof ApiError) {
      return error;
    }

    if (error instanceof Error) {
      return new ApiError(ApiErrorCode.INTERNAL_ERROR, error.message, undefined, error);
    }

    return new ApiError(ApiErrorCode.INTERNAL_ERROR, defaultMessage);
  }

  /**
   * Factory methods for common errors
   */
  static notFound(resource: string, id?: string): ApiError {
    return new ApiError(
      ApiErrorCode.NOT_FOUND,
      `${resource} not found`,
      id ? { id } : undefined
    );
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(ApiErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(ApiErrorCode.FORBIDDEN, message);
  }

  static validationError(message: string, fields?: Record<string, string[]>): ApiError {
    return new ApiError(ApiErrorCode.VALIDATION_ERROR, message, fields ? { fields } : undefined);
  }

  static rateLimited(retryAfter?: number): ApiError {
    return new ApiError(
      ApiErrorCode.RATE_LIMITED,
      'Too many requests. Please try again later.',
      retryAfter ? { retryAfter } : undefined
    );
  }

  static circuitBreakerOpen(service: string): ApiError {
    return new ApiError(
      ApiErrorCode.CIRCUIT_BREAKER_OPEN,
      `Service temporarily unavailable: ${service}`,
      { service }
    );
  }

  static timeout(operation: string, timeoutMs: number): ApiError {
    return new ApiError(
      ApiErrorCode.TIMEOUT,
      `Operation timed out: ${operation}`,
      { operation, timeoutMs }
    );
  }

  static externalServiceError(service: string, cause?: Error): ApiError {
    return new ApiError(
      ApiErrorCode.EXTERNAL_SERVICE_ERROR,
      `External service error: ${service}`,
      { service },
      cause
    );
  }

  static internalError(message = 'Internal server error', cause?: Error): ApiError {
    return new ApiError(ApiErrorCode.INTERNAL_ERROR, message, undefined, cause);
  }
}

/**
 * Express error handler middleware
 */
export function apiErrorHandler(
  error: unknown,
  req: { id?: string },
  res: { status: (code: number) => { json: (data: unknown) => void } },
  next: () => void
): void {
  const apiError = ApiError.fromError(error);

  // Set request ID if available
  if (req.id) {
    apiError.setRequestId(req.id);
  }

  // Log error based on severity with structured logging
  const logData = {
    code: apiError.code,
    severity: apiError.severity,
    statusCode: apiError.statusCode,
    requestId: apiError.requestId,
    details: apiError.details,
  };

  if (apiError.severity === ErrorSeverity.CRITICAL) {
    logger.error(logData, apiError.message);
  } else if (apiError.severity === ErrorSeverity.HIGH) {
    logger.error(logData, apiError.message);
  } else if (apiError.severity === ErrorSeverity.MEDIUM) {
    logger.warn(logData, apiError.message);
  } else {
    logger.info(logData, apiError.message);
  }

  // Send response (include stack trace only in development)
  const includeStack = process.env.NODE_ENV === 'development';
  res.status(apiError.statusCode).json({
    error: apiError.toJSON(includeStack),
  });
}

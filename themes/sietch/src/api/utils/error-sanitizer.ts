/**
 * Error Sanitization Utility
 *
 * Sprint 113: Security Remediation (HIGH-004)
 *
 * Sanitizes error responses for production use, preventing internal
 * details from leaking to clients while maintaining useful debug
 * information in logs.
 *
 * @module api/utils/error-sanitizer
 */

import { randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';
import { SimulationErrorCode } from '../../services/sandbox/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Safe error response sent to clients
 */
export interface SanitizedErrorResponse {
  /** User-safe error message */
  error: string;
  /** Error reference ID for log correlation */
  errorRef: string;
  /** HTTP status code */
  status: number;
  /** Additional context (only in development) */
  details?: unknown;
}

/**
 * Internal error log entry
 */
export interface ErrorLogEntry {
  /** Error reference ID for log correlation */
  errorRef: string;
  /** Original error message */
  message: string;
  /** Error code if available */
  code?: string;
  /** Stack trace */
  stack?: string;
  /** Request path */
  path?: string;
  /** Request method */
  method?: string;
  /** User ID if authenticated */
  userId?: string;
  /** Additional error details */
  details?: unknown;
}

/**
 * Error context from request
 */
export interface ErrorContext {
  path?: string;
  method?: string;
  userId?: string;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Check if we're in development mode (verbose errors allowed)
 *
 * Sprint 138 (MED-002): Only development and test environments get verbose errors.
 * Staging and production environments get sanitized errors to prevent information leakage.
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

/**
 * Check if error details should be included in response
 *
 * Sprint 138 (MED-002): Staging environments now get sanitized errors like production.
 * Only development and test environments show detailed error information.
 */
function shouldIncludeErrorDetails(): boolean {
  const env = process.env.NODE_ENV;
  // Only development and test get details - staging and production do not
  return env === 'development' || env === 'test';
}

// =============================================================================
// Error Reference ID Generation
// =============================================================================

/**
 * Generate a unique error reference ID
 *
 * Format: ERR-{timestamp}-{random}
 * Example: ERR-1705687200-a1b2c3d4
 *
 * @returns Unique error reference ID
 */
export function generateErrorRef(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = randomBytes(4).toString('hex');
  return `ERR-${timestamp}-${random}`;
}

// =============================================================================
// Error Code to Message Mapping
// =============================================================================

/**
 * Map simulation error codes to user-safe messages
 */
const SIMULATION_ERROR_MESSAGES: Record<SimulationErrorCode, string> = {
  [SimulationErrorCode.NOT_FOUND]: 'The requested resource was not found.',
  [SimulationErrorCode.VALIDATION_ERROR]: 'The request contains invalid data.',
  [SimulationErrorCode.VERSION_CONFLICT]: 'The resource was modified by another request. Please refresh and try again.',
  [SimulationErrorCode.STORAGE_ERROR]: 'A temporary error occurred. Please try again.',
  [SimulationErrorCode.SANDBOX_INACTIVE]: 'The sandbox is not currently active.',
};

/**
 * Map simulation error codes to HTTP status codes
 */
const SIMULATION_STATUS_CODES: Record<SimulationErrorCode, number> = {
  [SimulationErrorCode.NOT_FOUND]: 404,
  [SimulationErrorCode.VALIDATION_ERROR]: 400,
  [SimulationErrorCode.VERSION_CONFLICT]: 409,
  [SimulationErrorCode.STORAGE_ERROR]: 500,
  [SimulationErrorCode.SANDBOX_INACTIVE]: 403,
};

/**
 * Generic error messages for common scenarios
 */
const GENERIC_ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  UNAUTHORIZED: { message: 'Authentication is required.', status: 401 },
  FORBIDDEN: { message: 'You do not have permission to perform this action.', status: 403 },
  NOT_FOUND: { message: 'The requested resource was not found.', status: 404 },
  RATE_LIMITED: { message: 'Too many requests. Please try again later.', status: 429 },
  INTERNAL: { message: 'An unexpected error occurred. Please try again later.', status: 500 },
};

// =============================================================================
// Sanitization Functions
// =============================================================================

/**
 * Check if an error is a simulation error with a code
 */
function isSimulationError(error: unknown): error is { code: SimulationErrorCode; message: string; details?: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    Object.values(SimulationErrorCode).includes((error as { code: SimulationErrorCode }).code)
  );
}

/**
 * Sanitize an error for client response
 *
 * In production:
 * - Hides internal error messages
 * - Removes stack traces
 * - Generates error reference ID for log correlation
 *
 * In development:
 * - Includes original error details
 *
 * @param error - The error to sanitize
 * @param context - Request context for logging
 * @returns Object containing sanitized response and log entry
 */
export function sanitizeError(
  error: unknown,
  context: ErrorContext = {}
): { response: SanitizedErrorResponse; logEntry: ErrorLogEntry } {
  const errorRef = generateErrorRef();
  // Sprint 138 (MED-002): Use shouldIncludeErrorDetails instead of isDevelopment
  // This ensures staging gets sanitized errors like production
  const includeDetails = shouldIncludeErrorDetails();

  // Default values
  let userMessage = GENERIC_ERROR_MESSAGES.INTERNAL?.message ?? 'An unexpected error occurred. Please try again later.';
  let status = 500;
  let code: string | undefined;
  let originalMessage = 'Unknown error';
  let stack: string | undefined;
  let details: unknown;

  // Extract error info based on type
  if (error instanceof Error) {
    originalMessage = error.message;
    stack = error.stack;

    // Check for simulation error with code
    if (isSimulationError(error)) {
      code = error.code;
      userMessage = SIMULATION_ERROR_MESSAGES[error.code] || userMessage;
      status = SIMULATION_STATUS_CODES[error.code] || status;
      details = error.details;
    }
  } else if (typeof error === 'object' && error !== null) {
    // Handle error-like objects
    if ('message' in error) {
      originalMessage = String((error as { message: unknown }).message);
    }
    if ('code' in error && isSimulationError(error)) {
      code = error.code;
      userMessage = SIMULATION_ERROR_MESSAGES[error.code] || userMessage;
      status = SIMULATION_STATUS_CODES[error.code] || status;
      details = error.details;
    }
    if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
      status = (error as { status: number }).status;
    }
    if ('stack' in error) {
      stack = String((error as { stack: unknown }).stack);
    }
  } else if (typeof error === 'string') {
    originalMessage = error;
  }

  // Build log entry (always includes full details)
  const logEntry: ErrorLogEntry = {
    errorRef,
    message: originalMessage,
    code,
    stack,
    path: context.path,
    method: context.method,
    userId: context.userId,
    details,
  };

  // Build sanitized response
  const response: SanitizedErrorResponse = {
    error: userMessage,
    errorRef,
    status,
  };

  // Sprint 138 (MED-002): Only include details in development/test, not staging/production
  if (includeDetails) {
    response.details = {
      originalMessage,
      code,
      stack,
    };
  }

  return { response, logEntry };
}

/**
 * Sanitize and log an error, returning the sanitized response
 *
 * Convenience function that sanitizes the error and logs it.
 *
 * @param error - The error to sanitize
 * @param context - Request context for logging
 * @returns Sanitized error response
 */
export function sanitizeAndLogError(
  error: unknown,
  context: ErrorContext = {}
): SanitizedErrorResponse {
  const { response, logEntry } = sanitizeError(error, context);

  // Log the full error details
  logger.error(logEntry, `Error ${logEntry.errorRef}: ${logEntry.message}`);

  return response;
}

// =============================================================================
// Validation Error Sanitization
// =============================================================================

/**
 * Sanitize validation error details
 *
 * Removes specific patterns and values from Zod validation errors
 * to prevent information leakage about expected formats.
 *
 * @param issues - Zod validation issues
 * @returns Sanitized validation details
 */
export function sanitizeValidationErrors(
  issues: Array<{ path: (string | number)[]; message: string; code?: string }>
): Array<{ field: string; message: string }> {
  return issues.map((issue) => {
    const field = issue.path.join('.');
    let message = 'Invalid value';

    // Map common Zod error codes to safe messages
    switch (issue.code) {
      case 'too_small':
        message = 'Value is too short or too small';
        break;
      case 'too_big':
        message = 'Value is too long or too large';
        break;
      case 'invalid_type':
        message = 'Invalid type provided';
        break;
      case 'invalid_enum_value':
        message = 'Value is not one of the allowed options';
        break;
      case 'custom':
      case 'invalid_string':
        // Don't leak pattern info
        message = 'Invalid format';
        break;
      default:
        // Don't use original message in production as it may leak patterns
        if (isDevelopment()) {
          message = issue.message;
        }
    }

    return { field, message };
  });
}

// =============================================================================
// HTTP Error Helpers
// =============================================================================

/**
 * Create a sanitized unauthorized error response
 */
export function unauthorizedError(context: ErrorContext = {}): SanitizedErrorResponse {
  const errorRef = generateErrorRef();

  logger.warn(
    { errorRef, ...context },
    `Unauthorized access attempt ${errorRef}`
  );

  return {
    error: GENERIC_ERROR_MESSAGES.UNAUTHORIZED?.message ?? 'Authentication is required.',
    errorRef,
    status: GENERIC_ERROR_MESSAGES.UNAUTHORIZED?.status ?? 401,
  };
}

/**
 * Create a sanitized forbidden error response
 */
export function forbiddenError(context: ErrorContext = {}): SanitizedErrorResponse {
  const errorRef = generateErrorRef();

  logger.warn(
    { errorRef, ...context },
    `Forbidden access attempt ${errorRef}`
  );

  return {
    error: GENERIC_ERROR_MESSAGES.FORBIDDEN?.message ?? 'You do not have permission to perform this action.',
    errorRef,
    status: GENERIC_ERROR_MESSAGES.FORBIDDEN?.status ?? 403,
  };
}

/**
 * Create a sanitized not found error response
 */
export function notFoundError(context: ErrorContext = {}): SanitizedErrorResponse {
  const errorRef = generateErrorRef();

  return {
    error: GENERIC_ERROR_MESSAGES.NOT_FOUND?.message ?? 'The requested resource was not found.',
    errorRef,
    status: GENERIC_ERROR_MESSAGES.NOT_FOUND?.status ?? 404,
  };
}

/**
 * Create a sanitized rate limit error response
 */
export function rateLimitedError(
  retryAfter: number,
  context: ErrorContext = {}
): SanitizedErrorResponse {
  const errorRef = generateErrorRef();

  logger.warn(
    { errorRef, retryAfter, ...context },
    `Rate limit exceeded ${errorRef}`
  );

  return {
    error: `${GENERIC_ERROR_MESSAGES.RATE_LIMITED?.message ?? 'Too many requests. Please try again later.'} Try again in ${retryAfter} seconds.`,
    errorRef,
    status: GENERIC_ERROR_MESSAGES.RATE_LIMITED?.status ?? 429,
  };
}

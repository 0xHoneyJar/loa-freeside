/**
 * Error Handling Utilities
 *
 * Provides typed application errors and retry logic for transient failures.
 */

import { logger } from './logger.js';

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Discord API error
 */
export class DiscordAPIError extends AppError {
  public readonly discordCode: number | undefined;

  constructor(message: string, discordCode?: number) {
    super(message, 'DISCORD_API_ERROR', 503);
    this.discordCode = discordCode;
  }
}

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(message: string, public readonly sqliteCode?: string) {
    super(message, 'DATABASE_ERROR', 500);
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  public readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.field = field;
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  public readonly resource: string;

  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404);
    this.resource = resource;
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number = 60) {
    super('Rate limit exceeded', 'RATE_LIMIT', 429);
    this.retryAfter = retryAfter;
  }
}

/**
 * Configuration for retry logic
 */
export interface RetryConfig {
  /** Maximum number of attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Optional custom retry condition */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (transient)
 */
export function isRetryableError(error: unknown): boolean {
  // Discord rate limits
  if (error instanceof Error && error.message.includes('rate limit')) {
    return true;
  }

  // Network errors
  if (
    error instanceof Error &&
    (error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('socket hang up') ||
      error.message.includes('network'))
  ) {
    return true;
  }

  // HTTP 5xx errors
  if (error instanceof AppError && error.statusCode >= 500) {
    return true;
  }

  // Discord API errors that are retryable
  if (error instanceof DiscordAPIError) {
    const retryableCodes = [500, 502, 503, 504];
    return retryableCodes.includes(error.discordCode ?? 0);
  }

  return false;
}

/**
 * Execute a function with retry logic for transient failures
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: string
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  const shouldRetry = cfg.shouldRetry ?? isRetryableError;

  let lastError: unknown;
  let delay = cfg.initialDelayMs;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === cfg.maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      logger.warn(
        {
          attempt,
          maxAttempts: cfg.maxAttempts,
          delay,
          context,
          error: error instanceof Error ? error.message : String(error),
        },
        'Retrying after transient error'
      );

      await sleep(delay);
      delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Wrap an async function to handle errors gracefully
 * Returns null instead of throwing for expected failures
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError && error.isOperational) {
      logger.debug({ context, error: error.message }, 'Expected error occurred');
      return null;
    }

    logger.error(
      {
        context,
        error: error instanceof Error ? error.message : String(error),
      },
      'Unexpected error in safe execute'
    );
    return null;
  }
}

/**
 * Format error for user-facing response (no internal details)
 */
export function formatUserError(error: unknown): { error: string; code?: string } {
  if (error instanceof AppError) {
    return {
      error: error.message,
      code: error.code,
    };
  }

  // Don't expose internal error details
  return {
    error: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
}

/**
 * Format error for API response
 */
export function formatApiError(error: unknown): {
  status: number;
  body: { error: string; code?: string; retryAfter?: number };
} {
  if (error instanceof RateLimitError) {
    return {
      status: 429,
      body: {
        error: error.message,
        code: error.code,
        retryAfter: error.retryAfter,
      },
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  // Don't expose internal error details
  return {
    status: 500,
    body: {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  };
}

/**
 * Log error without exposing sensitive data
 */
export function logError(
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  // Remove any sensitive fields from context
  const safeContext = { ...context };
  const sensitiveFields = [
    'discordUserId',
    'discord_user_id',
    'walletAddress',
    'wallet_address',
    'token',
    'password',
    'secret',
  ];

  for (const field of sensitiveFields) {
    if (field in safeContext) {
      safeContext[field] = '[REDACTED]';
    }
  }

  if (error instanceof AppError) {
    logger.error(
      {
        ...safeContext,
        errorCode: error.code,
        statusCode: error.statusCode,
        isOperational: error.isOperational,
        message: error.message,
      },
      'Application error'
    );
  } else if (error instanceof Error) {
    logger.error(
      {
        ...safeContext,
        message: error.message,
        name: error.name,
      },
      'Unexpected error'
    );
  } else {
    logger.error(
      {
        ...safeContext,
        error: String(error),
      },
      'Unknown error'
    );
  }
}

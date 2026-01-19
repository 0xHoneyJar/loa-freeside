/**
 * Error Recovery Strategies
 *
 * Sprint 101: Polish & Documentation
 *
 * Provides recovery strategies for common errors including
 * retry logic, state recovery, and helpful user guidance.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/iac/ErrorRecovery
 */

import {
  GaibError,
  StateLockError,
  RateLimitError,
  isRecoverableError,
  ErrorCodes,
  type ErrorCode,
} from './errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Recovery context for error handling
 */
export interface RecoveryContext {
  /** Current operation being performed */
  operation: string;
  /** Workspace name */
  workspace?: string;
  /** Current retry attempt (1-based) */
  attempt: number;
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Time spent on retries so far (ms) */
  elapsedTime: number;
}

/**
 * Recovery action to take
 */
export type RecoveryAction =
  | { type: 'retry'; delayMs: number }
  | { type: 'abort'; reason: string }
  | { type: 'prompt'; message: string; options: string[] }
  | { type: 'suggest'; message: string };

/**
 * Recovery strategy function
 */
export type RecoveryStrategy = (
  error: GaibError,
  context: RecoveryContext
) => RecoveryAction;

// ============================================================================
// Recovery Strategies
// ============================================================================

/**
 * Strategy for rate limit errors
 * Waits the specified time before retrying
 */
export function rateLimitStrategy(
  error: GaibError,
  context: RecoveryContext
): RecoveryAction {
  if (error instanceof RateLimitError) {
    // Respect Discord's retry-after, add small jitter
    const jitter = Math.random() * 500;
    const delay = error.retryAfter + jitter;

    // Don't retry global rate limits more than once
    if (error.global && context.attempt > 1) {
      return {
        type: 'abort',
        reason: 'Global rate limit hit multiple times. Try again later.',
      };
    }

    if (context.attempt < context.maxAttempts) {
      return { type: 'retry', delayMs: delay };
    }
  }

  return {
    type: 'abort',
    reason: 'Rate limit exceeded. Please wait before retrying.',
  };
}

/**
 * Strategy for state lock errors
 * Suggests waiting or force-unlock
 */
export function stateLockStrategy(
  error: GaibError,
  context: RecoveryContext
): RecoveryAction {
  if (error instanceof StateLockError) {
    const lockAge = Date.now() - new Date(error.lockInfo.created).getTime();
    const lockAgeMinutes = Math.round(lockAge / 60000);

    // If lock is old (> 30 min), suggest force-unlock
    if (lockAge > 30 * 60 * 1000) {
      return {
        type: 'suggest',
        message:
          `State has been locked for ${lockAgeMinutes} minutes.\n` +
          `This may be a stale lock. You can:\n` +
          `  1. Wait for the other operation to complete\n` +
          `  2. Run "gaib server force-unlock" to release the lock\n\n` +
          `Lock info:\n` +
          `  Held by: ${error.lockInfo.who}\n` +
          `  Operation: ${error.lockInfo.operation}\n` +
          `  Since: ${error.lockInfo.created}`,
      };
    }

    // For recent locks, just wait
    if (context.attempt < 3 && lockAge < 5 * 60 * 1000) {
      // Wait 5-10 seconds between retries for recent locks
      const delay = 5000 + Math.random() * 5000;
      return { type: 'retry', delayMs: delay };
    }
  }

  return {
    type: 'abort',
    reason: 'State is locked by another operation.',
  };
}

/**
 * Strategy for network errors
 * Retries with exponential backoff
 */
export function networkErrorStrategy(
  error: GaibError,
  context: RecoveryContext
): RecoveryAction {
  if (isRecoverableError(error)) {
    if (context.attempt < context.maxAttempts) {
      // Exponential backoff: 1s, 2s, 4s, 8s, ...
      const baseDelay = 1000;
      const delay = baseDelay * Math.pow(2, context.attempt - 1);
      const jitter = Math.random() * 500;

      return { type: 'retry', delayMs: delay + jitter };
    }
  }

  return {
    type: 'abort',
    reason: 'Network error persisted after multiple retries.',
  };
}

/**
 * Strategy for configuration errors
 * Provides helpful suggestions
 */
export function configErrorStrategy(
  error: GaibError,
  _context: RecoveryContext
): RecoveryAction {
  // Config errors are not recoverable through retry
  return {
    type: 'suggest',
    message: error.suggestion || 'Check your configuration file for errors.',
  };
}

// ============================================================================
// Error Recovery Manager
// ============================================================================

/**
 * Default recovery strategies by error code
 */
const defaultStrategies: Map<ErrorCode | string, RecoveryStrategy> = new Map([
  [ErrorCodes.DISCORD_RATE_LIMITED, rateLimitStrategy],
  [ErrorCodes.STATE_LOCKED, stateLockStrategy],
  [ErrorCodes.DISCORD_NETWORK_ERROR, networkErrorStrategy],
  [ErrorCodes.CONFIG_NOT_FOUND, configErrorStrategy],
  [ErrorCodes.CONFIG_PARSE_ERROR, configErrorStrategy],
  [ErrorCodes.CONFIG_VALIDATION_ERROR, configErrorStrategy],
]);

/**
 * Error recovery manager
 *
 * Handles error recovery with retry logic and user guidance.
 *
 * @example
 * ```typescript
 * const recovery = new ErrorRecovery({ maxAttempts: 3 });
 *
 * try {
 *   await recovery.withRecovery('apply', async () => {
 *     await applyChanges();
 *   });
 * } catch (error) {
 *   // Error after all recovery attempts exhausted
 * }
 * ```
 */
export class ErrorRecovery {
  private maxAttempts: number;
  private strategies: Map<ErrorCode | string, RecoveryStrategy>;
  private onRetry?: (context: RecoveryContext, error: GaibError) => void;

  constructor(options?: {
    maxAttempts?: number;
    onRetry?: (context: RecoveryContext, error: GaibError) => void;
  }) {
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.strategies = new Map(defaultStrategies);
    this.onRetry = options?.onRetry;
  }

  /**
   * Register a custom recovery strategy for an error code
   */
  registerStrategy(code: ErrorCode | string, strategy: RecoveryStrategy): void {
    this.strategies.set(code, strategy);
  }

  /**
   * Get recovery action for an error
   */
  getRecoveryAction(error: GaibError, context: RecoveryContext): RecoveryAction {
    // Look up strategy by error code
    const strategy = this.strategies.get(error.code);

    if (strategy) {
      return strategy(error, context);
    }

    // Default strategy: don't retry, provide suggestion if available
    if (error.suggestion) {
      return { type: 'suggest', message: error.suggestion };
    }

    return { type: 'abort', reason: error.message };
  }

  /**
   * Execute an operation with automatic recovery
   *
   * @param operation - Name of the operation (for logging)
   * @param fn - Async function to execute
   * @param workspace - Optional workspace name
   * @returns Result of the operation
   * @throws GaibError if all recovery attempts fail
   */
  async withRecovery<T>(
    operation: string,
    fn: () => Promise<T>,
    workspace?: string
  ): Promise<T> {
    let attempt = 1;
    const startTime = Date.now();

    while (true) {
      try {
        return await fn();
      } catch (error) {
        const gaibError =
          error instanceof GaibError
            ? error
            : new GaibError(error instanceof Error ? error.message : String(error), {
                code: ErrorCodes.CONFIG_PARSE_ERROR,
                cause: error instanceof Error ? error : undefined,
              });

        const context: RecoveryContext = {
          operation,
          workspace,
          attempt,
          maxAttempts: this.maxAttempts,
          elapsedTime: Date.now() - startTime,
        };

        const action = this.getRecoveryAction(gaibError, context);

        switch (action.type) {
          case 'retry':
            if (this.onRetry) {
              this.onRetry(context, gaibError);
            }
            await this.delay(action.delayMs);
            attempt++;
            continue;

          case 'abort':
            throw gaibError;

          case 'suggest':
          case 'prompt':
            // For now, just throw with suggestion attached
            throw gaibError;

          default:
            throw gaibError;
        }
      }
    }
  }

  /**
   * Sleep for a specified duration
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create an error recovery instance with default settings
 */
export function createErrorRecovery(options?: {
  maxAttempts?: number;
  onRetry?: (context: RecoveryContext, error: GaibError) => void;
}): ErrorRecovery {
  return new ErrorRecovery(options);
}

/**
 * Get a helpful message for common error scenarios
 */
export function getHelpfulMessage(error: GaibError): string {
  switch (error.code) {
    case ErrorCodes.CONFIG_NOT_FOUND:
      return (
        'Configuration file not found.\n\n' +
        'To get started:\n' +
        '  1. Run "gaib server init" to create a configuration file\n' +
        '  2. Or specify a path with -f/--file option'
      );

    case ErrorCodes.STATE_LOCKED:
      return (
        'State is currently locked.\n\n' +
        'This usually means another operation is in progress.\n' +
        'Options:\n' +
        '  1. Wait for the other operation to complete\n' +
        '  2. Run "gaib server lock-status" to check lock info\n' +
        '  3. Run "gaib server force-unlock" if the lock is stale'
      );

    case ErrorCodes.DISCORD_RATE_LIMITED:
      return (
        'Rate limited by Discord.\n\n' +
        'Discord limits API requests to prevent abuse.\n' +
        'Options:\n' +
        '  1. Wait a few seconds and try again\n' +
        '  2. Reduce the number of changes in a single operation\n' +
        '  3. Use --parallelism=1 to reduce concurrent requests'
      );

    case ErrorCodes.DISCORD_INVALID_TOKEN:
      return (
        'Invalid Discord bot token.\n\n' +
        'Steps to fix:\n' +
        '  1. Go to Discord Developer Portal\n' +
        '  2. Select your application\n' +
        '  3. Go to Bot section\n' +
        '  4. Reset and copy your token\n' +
        '  5. Set DISCORD_BOT_TOKEN environment variable'
      );

    case ErrorCodes.DISCORD_MISSING_PERMISSIONS:
      return (
        'Bot is missing required permissions.\n\n' +
        'Steps to fix:\n' +
        '  1. Go to Discord Developer Portal\n' +
        '  2. Generate a new invite URL with required permissions\n' +
        '  3. Reinvite the bot to your server\n\n' +
        'Required permissions for full functionality:\n' +
        '  - Manage Roles\n' +
        '  - Manage Channels\n' +
        '  - View Channels'
      );

    case ErrorCodes.WORKSPACE_NOT_FOUND:
      return (
        'Workspace not found.\n\n' +
        'Options:\n' +
        '  1. Run "gaib server workspace list" to see available workspaces\n' +
        '  2. Run "gaib server workspace new <name>" to create a new workspace\n' +
        '  3. Run "gaib server workspace select <name> --create" to create if missing'
      );

    default:
      return error.suggestion || error.message;
  }
}

/**
 * Check if an operation should be retried based on error
 */
export function shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }

  if (error instanceof RateLimitError) {
    // Don't retry global rate limits too many times
    return !error.global || attempt < 2;
  }

  return isRecoverableError(error);
}

/**
 * Calculate retry delay with exponential backoff and jitter
 */
export function calculateRetryDelay(attempt: number, baseDelay: number = 1000): number {
  // Exponential backoff: 1s, 2s, 4s, 8s...
  const exponential = baseDelay * Math.pow(2, attempt - 1);
  // Add jitter (0-25% of delay)
  const jitter = Math.random() * exponential * 0.25;
  // Cap at 30 seconds
  return Math.min(exponential + jitter, 30000);
}

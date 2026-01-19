/**
 * Error Recovery Tests
 *
 * Sprint 101: Polish & Documentation
 *
 * Unit tests for error recovery strategies.
 *
 * @module packages/cli/commands/server/iac/__tests__/ErrorRecovery.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ErrorRecovery,
  createErrorRecovery,
  getHelpfulMessage,
  shouldRetry,
  calculateRetryDelay,
  rateLimitStrategy,
  stateLockStrategy,
  networkErrorStrategy,
  configErrorStrategy,
  type RecoveryContext,
} from '../ErrorRecovery.js';
import {
  GaibError,
  RateLimitError,
  StateLockError,
  ConfigNotFoundError,
  ConfigValidationError,
  InvalidTokenError,
  ErrorCodes,
} from '../errors.js';

// Helper to create a context
function createContext(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    operation: 'test',
    attempt: 1,
    maxAttempts: 3,
    elapsedTime: 0,
    ...overrides,
  };
}

describe('ErrorRecovery', () => {
  describe('getRecoveryAction()', () => {
    it('uses rate limit strategy for RateLimitError', () => {
      const recovery = createErrorRecovery();
      const error = new RateLimitError(1000);
      const context = createContext();

      const action = recovery.getRecoveryAction(error, context);

      expect(action.type).toBe('retry');
      if (action.type === 'retry') {
        expect(action.delayMs).toBeGreaterThanOrEqual(1000);
      }
    });

    it('uses state lock strategy for StateLockError', () => {
      const recovery = createErrorRecovery();
      const error = new StateLockError({
        id: 'lock-123',
        who: 'user@host',
        operation: 'apply',
        created: new Date().toISOString(),
      });
      const context = createContext();

      const action = recovery.getRecoveryAction(error, context);

      // For recent locks, it should retry
      expect(action.type).toBe('retry');
    });

    it('uses config strategy for ConfigNotFoundError', () => {
      const recovery = createErrorRecovery();
      const error = new ConfigNotFoundError('/path/to/config.yaml');
      const context = createContext();

      const action = recovery.getRecoveryAction(error, context);

      expect(action.type).toBe('suggest');
    });

    it('returns suggestion for unknown errors with suggestion', () => {
      const recovery = createErrorRecovery();
      const error = new GaibError('Unknown error', {
        code: ErrorCodes.THEME_NOT_FOUND,
        suggestion: 'Try this instead',
      });
      const context = createContext();

      const action = recovery.getRecoveryAction(error, context);

      expect(action.type).toBe('suggest');
      if (action.type === 'suggest') {
        expect(action.message).toBe('Try this instead');
      }
    });
  });

  describe('registerStrategy()', () => {
    it('allows custom strategies to be registered', () => {
      const recovery = createErrorRecovery();
      const customStrategy = vi.fn().mockReturnValue({ type: 'abort', reason: 'Custom' });

      recovery.registerStrategy(ErrorCodes.THEME_NOT_FOUND, customStrategy);

      const error = new GaibError('Theme error', { code: ErrorCodes.THEME_NOT_FOUND });
      const context = createContext();

      const action = recovery.getRecoveryAction(error, context);

      expect(customStrategy).toHaveBeenCalledWith(error, context);
      expect(action.type).toBe('abort');
    });

    it('custom strategies override defaults', () => {
      const recovery = createErrorRecovery();
      const customStrategy = vi.fn().mockReturnValue({ type: 'abort', reason: 'Overridden' });

      recovery.registerStrategy(ErrorCodes.DISCORD_RATE_LIMITED, customStrategy);

      const error = new RateLimitError(1000);
      const context = createContext();

      const action = recovery.getRecoveryAction(error, context);

      expect(action.type).toBe('abort');
      expect(customStrategy).toHaveBeenCalled();
    });
  });

  describe('withRecovery()', () => {
    it('returns result on success', async () => {
      const recovery = createErrorRecovery();

      const result = await recovery.withRecovery('test', async () => 'success');

      expect(result).toBe('success');
    });

    it('retries on recoverable error', async () => {
      const recovery = createErrorRecovery({ maxAttempts: 3 });
      let attempts = 0;

      const result = await recovery.withRecovery('test', async () => {
        attempts++;
        if (attempts < 2) {
          throw new RateLimitError(10); // Very short delay for test
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('calls onRetry callback', async () => {
      const onRetry = vi.fn();
      const recovery = createErrorRecovery({ maxAttempts: 3, onRetry });
      let attempts = 0;

      await recovery.withRecovery('test', async () => {
        attempts++;
        if (attempts < 2) {
          throw new RateLimitError(10);
        }
        return 'success';
      });

      expect(onRetry).toHaveBeenCalled();
    });

    it('throws after max attempts', async () => {
      const recovery = createErrorRecovery({ maxAttempts: 2 });

      await expect(
        recovery.withRecovery('test', async () => {
          throw new RateLimitError(10, true); // Global rate limit aborts quicker
        })
      ).rejects.toThrow();
    });
  });
});

// ============================================================================
// Rate Limit Strategy
// ============================================================================

describe('rateLimitStrategy', () => {
  it('returns retry action with delay including jitter', () => {
    const error = new RateLimitError(5000);
    const context = createContext();

    const action = rateLimitStrategy(error, context);

    expect(action.type).toBe('retry');
    if (action.type === 'retry') {
      expect(action.delayMs).toBeGreaterThanOrEqual(5000);
      expect(action.delayMs).toBeLessThan(5500); // jitter < 500
    }
  });

  it('aborts after max attempts', () => {
    const error = new RateLimitError(5000);
    const context = createContext({ attempt: 3, maxAttempts: 3 });

    const action = rateLimitStrategy(error, context);

    expect(action.type).toBe('abort');
  });

  it('aborts for global rate limit after first retry', () => {
    const error = new RateLimitError(5000, true);
    const context = createContext({ attempt: 2, maxAttempts: 5 });

    const action = rateLimitStrategy(error, context);

    expect(action.type).toBe('abort');
  });

  it('aborts for non-RateLimitError', () => {
    const error = new GaibError('Other', { code: ErrorCodes.CONFIG_NOT_FOUND });
    const context = createContext();

    const action = rateLimitStrategy(error, context);

    expect(action.type).toBe('abort');
  });
});

// ============================================================================
// State Lock Strategy
// ============================================================================

describe('stateLockStrategy', () => {
  it('returns retry for recent lock', () => {
    const error = new StateLockError({
      id: 'lock-123',
      who: 'user@host',
      operation: 'apply',
      created: new Date().toISOString(), // Just now
    });
    const context = createContext();

    const action = stateLockStrategy(error, context);

    expect(action.type).toBe('retry');
    if (action.type === 'retry') {
      expect(action.delayMs).toBeGreaterThanOrEqual(5000);
    }
  });

  it('returns suggest for old lock', () => {
    const oldDate = new Date();
    oldDate.setMinutes(oldDate.getMinutes() - 45); // 45 minutes ago

    const error = new StateLockError({
      id: 'lock-123',
      who: 'user@host',
      operation: 'apply',
      created: oldDate.toISOString(),
    });
    const context = createContext();

    const action = stateLockStrategy(error, context);

    expect(action.type).toBe('suggest');
    if (action.type === 'suggest') {
      expect(action.message).toContain('force-unlock');
    }
  });

  it('aborts after retries for moderately old lock', () => {
    const oldDate = new Date();
    oldDate.setMinutes(oldDate.getMinutes() - 10); // 10 minutes ago

    const error = new StateLockError({
      id: 'lock-123',
      who: 'user@host',
      operation: 'apply',
      created: oldDate.toISOString(),
    });
    const context = createContext({ attempt: 3 }); // After multiple attempts

    const action = stateLockStrategy(error, context);

    expect(action.type).toBe('abort');
  });
});

// ============================================================================
// Network Error Strategy
// ============================================================================

describe('networkErrorStrategy', () => {
  it('returns retry with exponential backoff for recoverable error', () => {
    const error = new GaibError('ETIMEDOUT', { code: ErrorCodes.DISCORD_NETWORK_ERROR, recoverable: true });
    const context = createContext();

    const action = networkErrorStrategy(error, context);

    expect(action.type).toBe('retry');
    if (action.type === 'retry') {
      expect(action.delayMs).toBeGreaterThan(0);
    }
  });

  it('increases delay on each attempt', () => {
    const error = new GaibError('ETIMEDOUT', { code: ErrorCodes.DISCORD_NETWORK_ERROR, recoverable: true });

    const action1 = networkErrorStrategy(error, createContext({ attempt: 1 }));
    const action2 = networkErrorStrategy(error, createContext({ attempt: 2 }));
    const action3 = networkErrorStrategy(error, createContext({ attempt: 3 }));

    if (action1.type === 'retry' && action2.type === 'retry' && action3.type === 'retry') {
      // Remove jitter by comparing base delays
      // Exponential: 1000, 2000, 4000
      expect(action2.delayMs).toBeGreaterThan(action1.delayMs);
      expect(action3.delayMs).toBeGreaterThan(action2.delayMs);
    }
  });

  it('aborts after max attempts', () => {
    const error = new GaibError('ETIMEDOUT', { code: ErrorCodes.DISCORD_NETWORK_ERROR, recoverable: true });
    const context = createContext({ attempt: 3, maxAttempts: 3 });

    const action = networkErrorStrategy(error, context);

    expect(action.type).toBe('abort');
  });

  it('aborts for non-recoverable error', () => {
    const error = new GaibError('Fatal error', { code: ErrorCodes.DISCORD_NETWORK_ERROR, recoverable: false });
    const context = createContext();

    const action = networkErrorStrategy(error, context);

    expect(action.type).toBe('abort');
  });
});

// ============================================================================
// Config Error Strategy
// ============================================================================

describe('configErrorStrategy', () => {
  it('returns suggest for ConfigNotFoundError', () => {
    const error = new ConfigNotFoundError('/path/to/config.yaml');
    const context = createContext();

    const action = configErrorStrategy(error, context);

    expect(action.type).toBe('suggest');
    if (action.type === 'suggest') {
      expect(action.message).toContain('init');
    }
  });

  it('returns suggest for ConfigValidationError', () => {
    const error = new ConfigValidationError(['Invalid field']);
    const context = createContext();

    const action = configErrorStrategy(error, context);

    expect(action.type).toBe('suggest');
  });

  it('uses error suggestion if available', () => {
    const error = new GaibError('Error', {
      code: ErrorCodes.CONFIG_PARSE_ERROR,
      suggestion: 'Custom suggestion',
    });
    const context = createContext();

    const action = configErrorStrategy(error, context);

    expect(action.type).toBe('suggest');
    if (action.type === 'suggest') {
      expect(action.message).toBe('Custom suggestion');
    }
  });
});

// ============================================================================
// Utility Functions
// ============================================================================

describe('getHelpfulMessage()', () => {
  it('returns helpful message for RateLimitError', () => {
    const error = new RateLimitError(5000);
    const message = getHelpfulMessage(error);

    expect(message).toContain('Rate limited');
  });

  it('returns helpful message for InvalidTokenError', () => {
    const error = new InvalidTokenError();
    const message = getHelpfulMessage(error);

    expect(message).toContain('token');
  });

  it('returns helpful message for ConfigNotFoundError', () => {
    const error = new ConfigNotFoundError('/path/to/config.yaml');
    const message = getHelpfulMessage(error);

    expect(message).toContain('init');
  });

  it('returns helpful message for StateLockError', () => {
    const error = new StateLockError({
      id: 'lock-123',
      who: 'user@host',
      operation: 'apply',
      created: new Date().toISOString(),
    });
    const message = getHelpfulMessage(error);

    expect(message).toContain('lock');
  });

  it('returns suggestion for unknown error', () => {
    const error = new GaibError('Unknown', {
      code: ErrorCodes.THEME_NOT_FOUND,
      suggestion: 'Check theme config',
    });
    const message = getHelpfulMessage(error);

    expect(message).toBe('Check theme config');
  });
});

describe('shouldRetry()', () => {
  it('returns true for recoverable errors under max attempts', () => {
    const error = new RateLimitError(5000);
    expect(shouldRetry(error, 1, 3)).toBe(true);
  });

  it('returns false for non-recoverable errors', () => {
    const error = new InvalidTokenError();
    expect(shouldRetry(error, 1, 3)).toBe(false);
  });

  it('returns false at max attempts', () => {
    const error = new RateLimitError(5000);
    expect(shouldRetry(error, 3, 3)).toBe(false);
  });

  it('returns false for global rate limit after first attempt', () => {
    const error = new RateLimitError(5000, true);
    expect(shouldRetry(error, 2, 5)).toBe(false);
  });

  it('returns true for global rate limit on first attempt', () => {
    const error = new RateLimitError(5000, true);
    expect(shouldRetry(error, 1, 5)).toBe(true);
  });
});

describe('calculateRetryDelay()', () => {
  it('calculates exponential backoff', () => {
    const delay1 = calculateRetryDelay(1);
    const delay2 = calculateRetryDelay(2);
    const delay3 = calculateRetryDelay(3);

    // Allow for jitter
    expect(delay2).toBeGreaterThan(delay1 * 1.5);
    expect(delay3).toBeGreaterThan(delay2 * 1.5);
  });

  it('respects base delay', () => {
    const baseDelay = 500;
    const delay = calculateRetryDelay(1, baseDelay);

    expect(delay).toBeGreaterThanOrEqual(baseDelay);
    expect(delay).toBeLessThan(baseDelay * 2); // With jitter
  });

  it('caps at max delay (30s)', () => {
    const delay = calculateRetryDelay(10); // Would be huge without cap

    expect(delay).toBeLessThanOrEqual(30000);
  });
});

// ============================================================================
// createErrorRecovery()
// ============================================================================

describe('createErrorRecovery()', () => {
  it('creates ErrorRecovery instance', () => {
    const recovery = createErrorRecovery();

    expect(recovery).toBeInstanceOf(ErrorRecovery);
  });

  it('accepts custom options', () => {
    const onRetry = vi.fn();
    const recovery = createErrorRecovery({
      maxAttempts: 10,
      onRetry,
    });

    expect(recovery).toBeInstanceOf(ErrorRecovery);
  });
});

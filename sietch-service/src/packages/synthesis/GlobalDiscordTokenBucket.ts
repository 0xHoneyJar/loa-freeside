/**
 * Global Discord Token Bucket (v5.0 - Sprint 45)
 *
 * Platform-wide distributed token bucket rate limiter using Redis + Lua scripts
 * for atomic operations. Prevents Discord 429 bans by enforcing a global 50 req/sec
 * limit shared across ALL workers and tenants.
 *
 * Key Features:
 * - Atomic token acquisition via Lua script (race-condition safe)
 * - Exponential backoff with jitter for fair scheduling
 * - Automatic token refill loop (50 tokens/sec)
 * - Timeout protection (30s default, configurable)
 *
 * Part of Phase 4: BullMQ + Global Token Bucket
 *
 * Security Considerations:
 * - CRIT-001: Token bucket shared across ALL tenants (no isolation)
 * - HIGH-003: Timeout prevents indefinite blocking
 * - MED-003: Exponential backoff prevents Redis overload
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

// =============================================================================
// Logger Interface
// =============================================================================

/**
 * Logger interface for dependency injection
 * Compatible with pino, winston, or console
 */
export interface Logger {
  info(message: string | object, ...args: any[]): void;
  warn(message: string | object, ...args: any[]): void;
  error(message: string | object, ...args: any[]): void;
  debug?(message: string | object, ...args: any[]): void;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Rate limit exceeded error (thrown after timeout)
 */
export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Token bucket error (internal errors)
 */
export class TokenBucketError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'TokenBucketError';
  }
}

// =============================================================================
// Configuration
// =============================================================================

export interface TokenBucketConfig {
  /**
   * Redis connection
   */
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };

  /**
   * Maximum tokens in bucket (Discord ~50 req/sec)
   * @default 50
   */
  maxTokens?: number;

  /**
   * Tokens to refill per second
   * @default 50
   */
  refillRate?: number;

  /**
   * Redis key for token bucket
   * @default 'discord:global:tokens'
   */
  bucketKey?: string;

  /**
   * Default timeout for acquireWithWait (milliseconds)
   * @default 30000 (30 seconds)
   */
  defaultTimeout?: number;

  /**
   * Initial backoff delay (milliseconds)
   * @default 100
   */
  initialBackoff?: number;

  /**
   * Maximum backoff delay (milliseconds)
   * @default 1000
   */
  maxBackoff?: number;

  /**
   * Logger instance for dependency injection
   * @default console
   */
  logger?: Logger;
}

// =============================================================================
// Token Bucket Statistics
// =============================================================================

export interface TokenBucketStats {
  currentTokens: number;
  maxTokens: number;
  refillRate: number;
  utilizationPercent: number; // (maxTokens - currentTokens) / maxTokens * 100
}

// =============================================================================
// Global Discord Token Bucket
// =============================================================================

/**
 * GlobalDiscordTokenBucket
 *
 * Distributed rate limiter for Discord API operations.
 * Uses Redis + Lua scripts for atomic token acquisition.
 *
 * **CRITICAL**: This bucket is shared across ALL workers and tenants.
 * There is ONE global limit for the entire platform.
 */
export class GlobalDiscordTokenBucket {
  private redis: typeof Redis;
  private config: Required<Omit<TokenBucketConfig, 'redis' | 'logger'>>;
  private logger: Logger;
  private refillIntervalId: NodeJS.Timeout | null = null;
  private isInitialized = false;

  /**
   * Lua script for atomic token acquisition
   *
   * Algorithm:
   * 1. Get current token count (or initialize to maxTokens)
   * 2. Check if enough tokens available
   * 3. If yes: decrement tokens and return 1 (success)
   * 4. If no: return 0 (failure)
   *
   * KEYS[1] = bucket key
   * ARGV[1] = maxTokens (for initialization)
   * ARGV[2] = tokens to acquire
   */
  private readonly LUA_ACQUIRE = `
    local current = tonumber(redis.call('GET', KEYS[1]))
    if current == nil then
      current = tonumber(ARGV[1])
      redis.call('SET', KEYS[1], current)
    end
    if current >= tonumber(ARGV[2]) then
      redis.call('DECRBY', KEYS[1], ARGV[2])
      return 1
    end
    return 0
  `;

  /**
   * Lua script for atomic token refill
   *
   * Algorithm:
   * 1. Get current token count
   * 2. Add refillRate tokens
   * 3. Cap at maxTokens
   * 4. Set new value
   * 5. Return new token count
   *
   * KEYS[1] = bucket key
   * ARGV[1] = refillRate
   * ARGV[2] = maxTokens
   */
  private readonly LUA_REFILL = `
    local current = tonumber(redis.call('GET', KEYS[1]) or 0)
    local newVal = math.min(current + tonumber(ARGV[1]), tonumber(ARGV[2]))
    redis.call('SET', KEYS[1], newVal)
    return newVal
  `;

  constructor(config: TokenBucketConfig) {
    // Initialize logger
    this.logger = config.logger || console;

    // Initialize Redis connection
    this.redis = new Redis(config.redis.port, config.redis.host, {
      password: config.redis.password,
      db: config.redis.db || 0,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    // Store configuration with defaults
    this.config = {
      maxTokens: config.maxTokens || 50,
      refillRate: config.refillRate || 50,
      bucketKey: config.bucketKey || 'discord:global:tokens',
      defaultTimeout: config.defaultTimeout || 30000,
      initialBackoff: config.initialBackoff || 100,
      maxBackoff: config.maxBackoff || 1000,
    };

    // Handle Redis connection events
    this.redis.on('ready', () => {
      this.logger.info('Redis connection ready');
    });

    this.redis.on('error', (error: Error) => {
      this.logger.error({ error: error.message }, 'Redis error');
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });
  }

  /**
   * Initialize the token bucket and start refill loop
   *
   * Must be called before using acquire/acquireWithWait
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Wait for Redis to be ready
    if (this.redis.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new TokenBucketError('Redis connection timeout', 'REDIS_TIMEOUT'));
        }, 5000);

        this.redis.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Initialize bucket with maxTokens
    await this.redis.set(this.config.bucketKey, this.config.maxTokens);

    // Start refill loop
    this.startRefillLoop();

    this.isInitialized = true;
    this.logger.info({
      maxTokens: this.config.maxTokens,
      refillRate: this.config.refillRate,
      bucketKey: this.config.bucketKey,
    }, 'Token bucket initialized');
  }

  /**
   * Acquire tokens from the bucket (non-blocking)
   *
   * @param tokens - Number of tokens to acquire (default: 1)
   * @returns true if tokens acquired, false if insufficient tokens
   */
  async acquire(tokens = 1): Promise<boolean> {
    if (!this.isInitialized) {
      throw new TokenBucketError('Token bucket not initialized', 'NOT_INITIALIZED');
    }

    if (tokens < 1) {
      throw new TokenBucketError('Tokens must be >= 1', 'INVALID_TOKENS');
    }

    if (tokens > this.config.maxTokens) {
      throw new TokenBucketError(
        `Cannot acquire ${tokens} tokens (max: ${this.config.maxTokens})`,
        'TOKENS_EXCEED_MAX'
      );
    }

    try {
      const result = await this.redis.eval(
        this.LUA_ACQUIRE,
        1,
        this.config.bucketKey,
        this.config.maxTokens.toString(),
        tokens.toString()
      );

      return result === 1;
    } catch (error) {
      this.logger.error({
        error: (error as Error).message,
        tokens,
      }, 'Token acquisition failed');
      throw new TokenBucketError(
        `Failed to acquire tokens: ${(error as Error).message}`,
        'ACQUIRE_FAILED'
      );
    }
  }

  /**
   * Acquire tokens with exponential backoff and timeout
   *
   * Blocks until tokens are available or timeout is reached.
   *
   * @param tokens - Number of tokens to acquire (default: 1)
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @throws RateLimitExceededError if timeout reached
   */
  async acquireWithWait(tokens = 1, timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs || this.config.defaultTimeout;
    const deadline = Date.now() + timeout;
    let backoff = this.config.initialBackoff;
    let attempts = 0;

    while (Date.now() < deadline) {
      attempts++;

      if (await this.acquire(tokens)) {
        // Success - log if it took multiple attempts
        if (attempts > 1) {
          this.logger.info({
            tokens,
            attempts,
            duration: Date.now() - (deadline - timeout),
          }, 'Acquired tokens after multiple attempts');
        }
        return;
      }

      // Calculate sleep time with exponential backoff + jitter
      const jitter = Math.random() * 100; // 0-100ms random jitter
      const sleepTime = Math.min(backoff + jitter, this.config.maxBackoff);

      // Check if we have time to sleep
      const remainingTime = deadline - Date.now();
      if (remainingTime < sleepTime) {
        // Not enough time for another attempt
        break;
      }

      await this.sleep(sleepTime);

      // Exponential backoff (double each time, capped at maxBackoff)
      backoff = Math.min(backoff * 2, this.config.maxBackoff);
    }

    throw new RateLimitExceededError(
      `Global Discord rate limit timeout after ${attempts} attempts (${timeout}ms)`
    );
  }

  /**
   * Get current bucket statistics
   */
  async getStats(): Promise<TokenBucketStats> {
    if (!this.isInitialized) {
      throw new TokenBucketError('Token bucket not initialized', 'NOT_INITIALIZED');
    }

    const currentTokens = parseInt(
      (await this.redis.get(this.config.bucketKey)) || '0',
      10
    );

    const utilizationPercent =
      ((this.config.maxTokens - currentTokens) / this.config.maxTokens) * 100;

    return {
      currentTokens,
      maxTokens: this.config.maxTokens,
      refillRate: this.config.refillRate,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100, // Round to 2 decimals
    };
  }

  /**
   * Get current token count (for monitoring)
   */
  async getCurrentTokens(): Promise<number> {
    if (!this.isInitialized) {
      throw new TokenBucketError('Token bucket not initialized', 'NOT_INITIALIZED');
    }

    return parseInt((await this.redis.get(this.config.bucketKey)) || '0', 10);
  }

  /**
   * Reset bucket to maxTokens (for testing or emergency)
   */
  async reset(): Promise<void> {
    if (!this.isInitialized) {
      throw new TokenBucketError('Token bucket not initialized', 'NOT_INITIALIZED');
    }

    await this.redis.set(this.config.bucketKey, this.config.maxTokens);
    this.logger.info({
      maxTokens: this.config.maxTokens,
    }, 'Token bucket reset');
  }

  /**
   * Start automatic token refill loop
   *
   * Refills tokens every second at the configured refillRate.
   */
  private startRefillLoop(): void {
    if (this.refillIntervalId) {
      return; // Already running
    }

    this.refillIntervalId = setInterval(async () => {
      try {
        const newTokens = await this.redis.eval(
          this.LUA_REFILL,
          1,
          this.config.bucketKey,
          this.config.refillRate.toString(),
          this.config.maxTokens.toString()
        );

        // Log only if we're at max (bucket refilled from empty)
        if (newTokens === this.config.maxTokens) {
          this.logger.info('Token bucket refilled to maximum');
        }
      } catch (error) {
        this.logger.error({
          error: (error as Error).message,
        }, 'Token refill error');
      }
    }, 1000); // Refill every second

    this.logger.info({
      refillRate: this.config.refillRate,
      intervalMs: 1000,
    }, 'Token refill loop started');
  }

  /**
   * Stop automatic token refill loop
   */
  private stopRefillLoop(): void {
    if (this.refillIntervalId) {
      clearInterval(this.refillIntervalId);
      this.refillIntervalId = null;
      this.logger.info('Token refill loop stopped');
    }
  }

  /**
   * Close the token bucket and Redis connection
   */
  async close(): Promise<void> {
    this.stopRefillLoop();

    if (this.redis) {
      await this.redis.quit();
    }

    this.isInitialized = false;
    this.logger.info('Token bucket closed');
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.redis.status === 'ready';
  }
}

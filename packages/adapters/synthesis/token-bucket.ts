/**
 * GlobalTokenBucket
 *
 * Sprint S-21: Synthesis Engine & Rate Limiting
 *
 * Redis-backed token bucket for platform-wide rate limiting of Discord API calls.
 * Uses Lua script for atomic token acquisition.
 *
 * Features:
 * - 50 tokens/sec refill rate (per SDD §6.3.5)
 * - Atomic acquire via Lua script
 * - acquireWithWait() blocks until token available
 * - Prometheus metrics for monitoring
 *
 * @see SDD §6.3.5 Global Token Bucket
 */

import type { Logger } from 'pino';
import type {
  IGlobalTokenBucket,
  TokenBucketStatus,
} from '@freeside/core/ports';
import { TOKEN_BUCKET_CONFIG } from '@freeside/core/ports';

// =============================================================================
// Types
// =============================================================================

/**
 * Redis client interface.
 */
export interface RedisClient {
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<number>;
}

/**
 * Prometheus metrics interface for token bucket.
 */
export interface TokenBucketMetrics {
  /** Counter: Token bucket exhausted (max wait exceeded) */
  tokenBucketExhausted: { inc(): void };
  /** Counter: Token bucket waits (had to wait for token) */
  tokenBucketWaits: { inc(): void };
  /** Counter: Tokens acquired successfully */
  tokensAcquired: { inc(): void };
  /** Gauge: Current tokens available */
  currentTokens: { set(value: number): void };
}

/**
 * Options for GlobalTokenBucket.
 */
export interface TokenBucketOptions {
  /** Redis client */
  redis: RedisClient;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: TokenBucketMetrics;
  /** Redis key (default: synthesis:token_bucket) */
  redisKey?: string;
  /** Maximum tokens (default: 50) */
  maxTokens?: number;
  /** Refill rate per second (default: 50) */
  refillRate?: number;
}

// =============================================================================
// Lua Script
// =============================================================================

/**
 * Lua script for atomic token acquisition.
 *
 * Returns 1 if token acquired, 0 if bucket empty.
 * Handles refill calculation atomically.
 */
const ACQUIRE_TOKEN_SCRIPT = `
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(bucket[1]) or maxTokens
local lastRefill = tonumber(bucket[2]) or now

-- Refill tokens based on elapsed time
local elapsed = (now - lastRefill) / 1000
local tokensToAdd = elapsed * refillRate
tokens = math.min(maxTokens, tokens + tokensToAdd)

if tokens >= 1 then
  -- Consume token
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
  return 1
else
  -- Update lastRefill even if no token available
  redis.call('HSET', key, 'lastRefill', now)
  return 0
end
`;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Redis-backed global token bucket.
 */
export class GlobalTokenBucket implements IGlobalTokenBucket {
  private readonly redis: RedisClient;
  private readonly log: Logger;
  private readonly metrics: TokenBucketMetrics;
  private readonly redisKey: string;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(options: TokenBucketOptions) {
    this.redis = options.redis;
    this.log = options.logger.child({ component: 'GlobalTokenBucket' });
    this.metrics = options.metrics;
    this.redisKey = options.redisKey ?? TOKEN_BUCKET_CONFIG.REDIS_KEY;
    this.maxTokens = options.maxTokens ?? TOKEN_BUCKET_CONFIG.MAX_TOKENS;
    this.refillRate = options.refillRate ?? TOKEN_BUCKET_CONFIG.REFILL_RATE;

    this.log.info(
      { maxTokens: this.maxTokens, refillRate: this.refillRate },
      'Global token bucket initialized'
    );
  }

  /**
   * Acquire a token, blocking until available or timeout.
   *
   * @param maxWaitMs - Maximum wait time (default: 5000ms)
   * @throws Error if max wait exceeded
   */
  async acquireWithWait(maxWaitMs: number = TOKEN_BUCKET_CONFIG.DEFAULT_MAX_WAIT_MS): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const acquired = await this.tryAcquire();
      if (acquired) {
        return;
      }

      // Wait and retry
      await this.sleep(TOKEN_BUCKET_CONFIG.POLL_INTERVAL_MS);
    }

    // Timeout exceeded
    this.metrics.tokenBucketExhausted.inc();
    this.log.warn({ maxWaitMs }, 'Token bucket exhausted, max wait exceeded');
    throw new Error('Token bucket exhausted, max wait exceeded');
  }

  /**
   * Try to acquire a token without blocking.
   *
   * @returns True if token acquired, false if bucket empty
   */
  async tryAcquire(): Promise<boolean> {
    const now = Date.now();

    const result = await this.redis.eval(
      ACQUIRE_TOKEN_SCRIPT,
      1,
      this.redisKey,
      this.maxTokens.toString(),
      this.refillRate.toString(),
      now.toString()
    );

    const acquired = result === 1;

    if (acquired) {
      this.metrics.tokensAcquired.inc();
    } else {
      this.metrics.tokenBucketWaits.inc();
    }

    return acquired;
  }

  /**
   * Get current bucket status.
   */
  async getStatus(): Promise<TokenBucketStatus> {
    const bucket = await this.redis.hgetall(this.redisKey);
    const now = Date.now();

    // Calculate current tokens with refill
    let tokens = parseFloat(bucket.tokens ?? String(this.maxTokens));
    const lastRefill = parseFloat(bucket.lastRefill ?? String(now));

    const elapsed = (now - lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    tokens = Math.min(this.maxTokens, tokens + tokensToAdd);

    // Update gauge metric
    this.metrics.currentTokens.set(tokens);

    return {
      tokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
      lastRefillAt: new Date(lastRefill),
    };
  }

  /**
   * Reset bucket to full (for testing).
   */
  async reset(): Promise<void> {
    await this.redis.del(this.redisKey);
    this.log.info('Token bucket reset to full');
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a global token bucket.
 *
 * @param options - Token bucket options
 * @returns Global token bucket instance
 */
export function createGlobalTokenBucket(options: TokenBucketOptions): IGlobalTokenBucket {
  return new GlobalTokenBucket(options);
}

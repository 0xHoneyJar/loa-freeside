/**
 * Redis Service (v5.1 - Sprint 67 Security Hardening)
 *
 * Manages Redis connection and provides caching utilities for:
 * - Entitlement caching (5-minute TTL)
 * - Webhook event deduplication (24-hour TTL)
 * - Event processing locks (30-second TTL)
 * - Local rate limiter fallback when Redis unavailable
 *
 * Security: Implements fail-safe pattern with local rate limiting
 * when Redis is unavailable, preventing unbounded concurrency.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type {
  Entitlements,
  SubscriptionTier,
  Feature,
  EntitlementSource,
} from '../../types/billing.js';

// =============================================================================
// Types
// =============================================================================

type RedisClient = any; // Use any for ioredis client type

// =============================================================================
// Constants
// =============================================================================

/** Default TTL for entitlement cache (5 minutes) */
const DEFAULT_ENTITLEMENT_TTL = 300;

/** TTL for webhook event deduplication (24 hours) */
const WEBHOOK_DEDUP_TTL = 86400;

/** TTL for event processing locks (30 seconds) */
const EVENT_LOCK_TTL = 30;

/** TTL for leaderboard cache (60 seconds - Sprint 32) */
const LEADERBOARD_TTL = 60;

/** Redis key prefixes */
const KEY_PREFIX = {
  entitlement: 'entitlement',
  webhookEvent: 'webhook:event',
  eventLock: 'webhook:lock',
  leaderboard: 'leaderboard',
} as const;

// =============================================================================
// Local Rate Limiter (Fallback for Redis Unavailable)
// =============================================================================

/**
 * Token bucket rate limiter configuration
 */
interface RateLimiterConfig {
  /** Maximum tokens (burst capacity) */
  maxTokens: number;
  /** Token refill rate per second */
  refillRate: number;
}

/**
 * Token bucket state for a single event type
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Local in-memory rate limiter using token bucket algorithm
 *
 * Used when Redis is unavailable to provide safe fallback behavior
 * that prevents unbounded concurrency while still allowing some requests.
 */
class LocalRateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: RateLimiterConfig;
  private fallbackCount = 0;

  constructor(config: RateLimiterConfig = { maxTokens: 10, refillRate: 10 }) {
    this.config = config;
  }

  /**
   * Try to acquire a token for the given event type
   * Returns true if allowed, false if rate limited
   */
  tryAcquire(eventType: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(eventType);

    if (!bucket) {
      // Initialize new bucket with full tokens
      bucket = {
        tokens: this.config.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(eventType, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    const refill = elapsed * this.config.refillRate;
    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + refill);
    bucket.lastRefill = now;

    // Try to consume a token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.fallbackCount++;
      return true;
    }

    return false;
  }

  /**
   * Get the number of fallback requests processed
   */
  getFallbackCount(): number {
    return this.fallbackCount;
  }

  /**
   * Reset all buckets (for testing)
   */
  reset(): void {
    this.buckets.clear();
    this.fallbackCount = 0;
  }

  /**
   * Clean up expired buckets (call periodically)
   */
  cleanup(maxAge: number = 60000): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(key);
      }
    }
  }
}

// =============================================================================
// Redis Service Class
// =============================================================================

class RedisService {
  private client: RedisClient | null = null;
  private isConnecting = false;
  private connectionError: Error | null = null;
  private localRateLimiter: LocalRateLimiter = new LocalRateLimiter();
  private redisFallbackTotal = 0;
  private lockTtlExhaustedTotal = 0;

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  /**
   * Connect to Redis
   * Uses exponential backoff retry with maxRetries from config
   */
  async connect(): Promise<void> {
    if (this.client && this.client.status === 'ready') {
      return;
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.isConnecting) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }

    if (!config.redis.url) {
      this.connectionError = new Error('Redis URL not configured');
      logger.warn('Redis not configured, operating without cache');
      return;
    }

    this.isConnecting = true;

    try {
      this.client = new Redis(config.redis.url, {
        maxRetriesPerRequest: config.redis.maxRetries,
        connectTimeout: config.redis.connectTimeout,
        retryStrategy: (times: number) => {
          if (times > config.redis.maxRetries) {
            logger.error(
              { attempts: times },
              'Redis connection failed after max retries'
            );
            return null; // Stop retrying
          }
          // Exponential backoff: 1s, 2s, 4s, 8s, etc.
          const delay = Math.min(times * 1000, 10000);
          logger.debug({ attempt: times, delay }, 'Retrying Redis connection');
          return delay;
        },
        reconnectOnError: (err: Error) => {
          // Reconnect on specific errors
          const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
          return targetErrors.some((targetError) =>
            err.message.includes(targetError)
          );
        },
      });

      // Event handlers
      this.client.on('connect', () => {
        logger.info('Redis client connecting');
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
        this.connectionError = null;
      });

      this.client.on('error', (err: Error) => {
        logger.error({ error: err.message }, 'Redis client error');
        this.connectionError = err;
      });

      this.client.on('close', () => {
        logger.warn('Redis connection closed');
      });

      this.client.on('reconnecting', (delay: number) => {
        logger.debug({ delay }, 'Redis reconnecting');
      });

      this.client.on('end', () => {
        logger.warn('Redis connection ended');
      });

      // Wait for connection
      await this.client.ping();
      logger.info('Redis connected successfully');
    } catch (error) {
      this.connectionError = error as Error;
      logger.warn(
        { error: (error as Error).message },
        'Redis connection failed, operating without cache'
      );
      this.client = null;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      logger.info('Redis disconnected');
    }
  }

  /**
   * Check if Redis is connected and ready
   */
  isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  /**
   * Get connection status for health checks
   */
  getConnectionStatus(): {
    connected: boolean;
    error: string | null;
    status: string;
  } {
    return {
      connected: this.isConnected(),
      error: this.connectionError?.message || null,
      status: this.client?.status || 'disconnected',
    };
  }

  // ---------------------------------------------------------------------------
  // Basic Operations
  // ---------------------------------------------------------------------------

  /**
   * Get value from Redis
   * Returns null if key doesn't exist or Redis unavailable
   */
  async get(key: string): Promise<string | null> {
    if (!this.isConnected()) {
      logger.debug({ key }, 'Redis unavailable for GET');
      return null;
    }

    try {
      return await this.client!.get(key);
    } catch (error) {
      logger.warn({ key, error: (error as Error).message }, 'Redis GET failed');
      return null;
    }
  }

  /**
   * Set value in Redis with optional TTL
   */
  async set(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.isConnected()) {
      logger.debug({ key }, 'Redis unavailable for SET');
      return;
    }

    try {
      if (ttlSeconds) {
        await this.client!.setex(key, ttlSeconds, value);
      } else {
        await this.client!.set(key, value);
      }
    } catch (error) {
      logger.warn({ key, error: (error as Error).message }, 'Redis SET failed');
    }
  }

  /**
   * Delete key from Redis
   */
  async del(key: string): Promise<void> {
    if (!this.isConnected()) {
      logger.debug({ key }, 'Redis unavailable for DEL');
      return;
    }

    try {
      await this.client!.del(key);
    } catch (error) {
      logger.warn({ key, error: (error as Error).message }, 'Redis DEL failed');
    }
  }

  /**
   * Check if key exists in Redis
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }

    try {
      const result = await this.client!.exists(key);
      return result === 1;
    } catch (error) {
      logger.warn(
        { key, error: (error as Error).message },
        'Redis EXISTS failed'
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Entitlement Cache Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get cached entitlements for a community
   */
  async getEntitlements(communityId: string): Promise<Entitlements | null> {
    const key = `${KEY_PREFIX.entitlement}:${communityId}`;
    const cached = await this.get(key);

    if (!cached) {
      return null;
    }

    try {
      const data = JSON.parse(cached);
      return {
        communityId: data.communityId,
        tier: data.tier as SubscriptionTier,
        maxMembers: data.maxMembers,
        features: data.features as Feature[],
        source: data.source as EntitlementSource,
        inGracePeriod: data.inGracePeriod,
        graceUntil: data.graceUntil ? new Date(data.graceUntil) : undefined,
        cachedAt: new Date(data.cachedAt),
        expiresAt: new Date(data.expiresAt),
      };
    } catch (error) {
      logger.warn(
        { communityId, error: (error as Error).message },
        'Failed to parse cached entitlements'
      );
      return null;
    }
  }

  /**
   * Cache entitlements for a community
   */
  async setEntitlements(
    communityId: string,
    entitlements: Entitlements
  ): Promise<void> {
    const key = `${KEY_PREFIX.entitlement}:${communityId}`;
    const ttl = config.redis.entitlementTtl || DEFAULT_ENTITLEMENT_TTL;

    const cacheData = {
      communityId: entitlements.communityId,
      tier: entitlements.tier,
      maxMembers: entitlements.maxMembers,
      features: entitlements.features,
      source: entitlements.source,
      inGracePeriod: entitlements.inGracePeriod,
      graceUntil: entitlements.graceUntil?.toISOString(),
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };

    await this.set(key, JSON.stringify(cacheData), ttl);
    logger.debug(
      { communityId, tier: entitlements.tier, ttl },
      'Cached entitlements'
    );
  }

  /**
   * Invalidate cached entitlements for a community
   */
  async invalidateEntitlements(communityId: string): Promise<void> {
    const key = `${KEY_PREFIX.entitlement}:${communityId}`;
    await this.del(key);
    logger.debug({ communityId }, 'Invalidated entitlements cache');
  }

  // ---------------------------------------------------------------------------
  // Webhook Deduplication Helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a webhook event has been processed
   */
  async isEventProcessed(eventId: string): Promise<boolean> {
    const key = `${KEY_PREFIX.webhookEvent}:${eventId}`;
    return await this.exists(key);
  }

  /**
   * Mark a webhook event as processed
   */
  async markEventProcessed(eventId: string): Promise<void> {
    const key = `${KEY_PREFIX.webhookEvent}:${eventId}`;
    await this.set(key, 'processed', WEBHOOK_DEDUP_TTL);
    logger.debug({ eventId }, 'Marked webhook event as processed');
  }

  // ---------------------------------------------------------------------------
  // Event Lock Helpers
  // ---------------------------------------------------------------------------

  /**
   * Acquire a lock for processing a webhook event
   * Returns true if lock acquired, false if already locked
   *
   * SECURITY (Sprint 67): Uses local rate limiter when Redis unavailable
   * to prevent unbounded concurrency instead of fail-open behavior.
   *
   * @param eventId - Unique event identifier
   * @param ttlSeconds - Lock TTL in seconds (default: 30)
   */
  async acquireEventLock(eventId: string, ttlSeconds: number = EVENT_LOCK_TTL): Promise<boolean> {
    if (!this.isConnected()) {
      // SECURITY: Use local rate limiter instead of fail-open
      // This prevents unbounded concurrency when Redis is down
      const eventType = this.extractEventType(eventId);
      const allowed = this.localRateLimiter.tryAcquire(eventType);

      this.redisFallbackTotal++;
      logger.warn(
        {
          eventId,
          eventType,
          allowed,
          fallbackCount: this.localRateLimiter.getFallbackCount(),
          metric: 'sietch_redis_fallback_total',
        },
        'Redis unavailable, using local rate limiter for event lock'
      );

      return allowed;
    }

    const key = `${KEY_PREFIX.eventLock}:${eventId}`;

    try {
      // SET NX EX: Set if Not eXists with EXpiration
      const result = await this.client!.set(key, '1', 'EX', ttlSeconds, 'NX');
      const acquired = result === 'OK';

      if (acquired) {
        logger.debug({ eventId, ttl: ttlSeconds }, 'Acquired event lock');
      } else {
        logger.debug({ eventId }, 'Event lock already held');
      }

      return acquired;
    } catch (error) {
      // SECURITY: Use local rate limiter on Redis errors too
      const eventType = this.extractEventType(eventId);
      const allowed = this.localRateLimiter.tryAcquire(eventType);

      this.redisFallbackTotal++;
      logger.warn(
        {
          eventId,
          eventType,
          allowed,
          error: (error as Error).message,
          metric: 'sietch_redis_fallback_total',
        },
        'Redis lock failed, using local rate limiter fallback'
      );

      return allowed;
    }
  }

  /**
   * Extract event type from event ID for rate limiting purposes
   * Event IDs typically follow patterns like: evt_<type>_<uuid>
   */
  private extractEventType(eventId: string): string {
    // Try to extract type from common patterns
    // e.g., "evt_subscription_created_abc123" -> "subscription_created"
    const parts = eventId.split('_');
    if (parts.length >= 3) {
      return `${parts[1]}_${parts[2]}`;
    }
    // Default to "unknown" for unparseable IDs
    return 'unknown';
  }

  /**
   * Release a lock for a webhook event
   */
  async releaseEventLock(eventId: string): Promise<void> {
    const key = `${KEY_PREFIX.eventLock}:${eventId}`;
    await this.del(key);
    logger.debug({ eventId }, 'Released event lock');
  }

  // ---------------------------------------------------------------------------
  // Leaderboard Cache Helpers (Sprint 32)
  // ---------------------------------------------------------------------------

  /**
   * Get cached leaderboard data
   */
  async getLeaderboard(limit: number): Promise<unknown[] | null> {
    const key = `${KEY_PREFIX.leaderboard}:top${limit}`;
    const cached = await this.get(key);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached);
    } catch (error) {
      logger.warn(
        { limit, error: (error as Error).message },
        'Failed to parse cached leaderboard'
      );
      return null;
    }
  }

  /**
   * Cache leaderboard data
   */
  async setLeaderboard(limit: number, data: unknown[]): Promise<void> {
    const key = `${KEY_PREFIX.leaderboard}:top${limit}`;
    await this.set(key, JSON.stringify(data), LEADERBOARD_TTL);
    logger.debug({ limit, entryCount: data.length, ttl: LEADERBOARD_TTL }, 'Cached leaderboard');
  }

  /**
   * Invalidate leaderboard cache (all sizes)
   * Call this when badge counts change
   */
  async invalidateLeaderboard(): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      // Delete common leaderboard cache sizes
      const keys = [10, 20, 50, 100].map(
        (size) => `${KEY_PREFIX.leaderboard}:top${size}`
      );
      for (const key of keys) {
        await this.del(key);
      }
      logger.debug('Invalidated leaderboard cache');
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        'Failed to invalidate leaderboard cache'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Health & Monitoring
  // ---------------------------------------------------------------------------

  /**
   * Ping Redis to check connectivity
   */
  async ping(): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }

    try {
      const result = await this.client!.ping();
      return result === 'PONG';
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'Redis PING failed');
      return false;
    }
  }

  /**
   * Get Redis info for monitoring
   */
  async getInfo(): Promise<Record<string, string> | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const info = await this.client!.info('stats');
      const lines = info.split('\r\n');
      const stats: Record<string, string> = {};

      for (const line of lines) {
        if (line && !line.startsWith('#')) {
          const [key, value] = line.split(':');
          if (key && value) {
            stats[key] = value;
          }
        }
      }

      return stats;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'Redis INFO failed');
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Metrics (Sprint 67)
  // ---------------------------------------------------------------------------

  /**
   * Get fallback metrics for monitoring
   */
  getMetrics(): {
    redisFallbackTotal: number;
    localRateLimiterRequests: number;
    lockTtlExhaustedTotal: number;
  } {
    return {
      redisFallbackTotal: this.redisFallbackTotal,
      localRateLimiterRequests: this.localRateLimiter.getFallbackCount(),
      lockTtlExhaustedTotal: this.lockTtlExhaustedTotal,
    };
  }

  /**
   * Increment lock TTL exhausted counter
   */
  incrementLockTtlExhausted(): void {
    this.lockTtlExhaustedTotal++;
    logger.warn(
      { metric: 'sietch_lock_ttl_exhausted_total', count: this.lockTtlExhaustedTotal },
      'Lock TTL exhausted before operation completed'
    );
  }

  /**
   * Reset local rate limiter (for testing)
   */
  resetLocalRateLimiter(): void {
    this.localRateLimiter.reset();
    this.redisFallbackTotal = 0;
    this.lockTtlExhaustedTotal = 0;
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const redisService = new RedisService();

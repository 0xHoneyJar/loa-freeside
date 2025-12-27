/**
 * Redis Service (v4.0 - Sprint 24)
 *
 * Manages Redis connection and provides caching utilities for:
 * - Entitlement caching (5-minute TTL)
 * - Webhook event deduplication (24-hour TTL)
 * - Event processing locks (30-second TTL)
 *
 * Implements graceful degradation when Redis is unavailable.
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
// Redis Service Class
// =============================================================================

class RedisService {
  private client: RedisClient | null = null;
  private isConnecting = false;
  private connectionError: Error | null = null;

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
   */
  async acquireEventLock(eventId: string): Promise<boolean> {
    if (!this.isConnected()) {
      // If Redis unavailable, allow processing (no distributed locking)
      logger.debug({ eventId }, 'Redis unavailable, skipping event lock');
      return true;
    }

    const key = `${KEY_PREFIX.eventLock}:${eventId}`;

    try {
      // SET NX EX: Set if Not eXists with EXpiration
      const result = await this.client!.set(key, '1', 'EX', EVENT_LOCK_TTL, 'NX');
      const acquired = result === 'OK';

      if (acquired) {
        logger.debug({ eventId, ttl: EVENT_LOCK_TTL }, 'Acquired event lock');
      } else {
        logger.debug({ eventId }, 'Event lock already held');
      }

      return acquired;
    } catch (error) {
      logger.warn(
        { eventId, error: (error as Error).message },
        'Failed to acquire event lock, allowing processing'
      );
      // On error, allow processing to avoid blocking
      return true;
    }
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
}

// =============================================================================
// Export Singleton
// =============================================================================

export const redisService = new RedisService();

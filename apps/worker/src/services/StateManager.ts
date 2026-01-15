import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { CooldownResult, SessionData } from '../types.js';

/**
 * StateManager provides centralized state management in Redis.
 * Used for cooldowns, sessions, and idempotency tracking across workers.
 *
 * Key patterns:
 * - cd:{command}:{userId} - Cooldowns
 * - sess:{type}:{userId} - Sessions
 * - event:processed:{eventId} - Idempotency
 */
export class StateManager {
  private client: Redis | null = null;
  private readonly log: Logger;

  constructor(
    private readonly redisUrl: string,
    logger: Logger
  ) {
    this.log = logger.child({ component: 'StateManager' });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    this.log.info('Connecting to Redis');

    this.client = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 200, 5000);
        this.log.warn({ attempt: times, delayMs: delay }, 'Redis connection retry');
        return delay;
      },
      lazyConnect: false,
    });

    this.client.on('error', (error) => {
      this.log.error({ error }, 'Redis error');
    });

    this.client.on('connect', () => {
      this.log.info('Redis connected');
    });

    this.client.on('close', () => {
      this.log.warn('Redis connection closed');
    });

    // Test connection
    await this.client.ping();
    this.log.info('Redis connection verified');
  }

  /**
   * Check if connected to Redis
   */
  isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  /**
   * Ping Redis and return latency in ms
   */
  async ping(): Promise<number | null> {
    if (!this.client) {
      return null;
    }

    try {
      const start = Date.now();
      await this.client.ping();
      return Date.now() - start;
    } catch {
      return null;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.log.info('Redis connection closed');
    }
  }

  // ========== Generic Key Operations ==========

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Set a key with optional TTL
   */
  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    if (ttlMs) {
      await this.client.set(key, value, 'PX', ttlMs);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * Get a key value
   */
  async get(key: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    return this.client.get(key);
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    await this.client.del(key);
  }

  // ========== Cooldown Operations ==========

  /**
   * Set a cooldown for a command
   */
  async setCooldown(command: string, userId: string, ttlMs: number): Promise<void> {
    const key = `cd:${command}:${userId}`;
    const expireAt = Date.now() + ttlMs;
    await this.set(key, expireAt.toString(), ttlMs);
    this.log.debug({ command, userId, ttlMs }, 'Set cooldown');
  }

  /**
   * Check if user is on cooldown for a command
   */
  async getCooldown(command: string, userId: string): Promise<CooldownResult> {
    const key = `cd:${command}:${userId}`;
    const value = await this.get(key);

    if (!value) {
      return { isOnCooldown: false, remainingMs: 0 };
    }

    const expireAt = parseInt(value, 10);
    const remaining = expireAt - Date.now();

    if (remaining <= 0) {
      return { isOnCooldown: false, remainingMs: 0 };
    }

    return { isOnCooldown: true, remainingMs: remaining };
  }

  /**
   * Clear a cooldown (admin override)
   */
  async clearCooldown(command: string, userId: string): Promise<void> {
    const key = `cd:${command}:${userId}`;
    await this.delete(key);
    this.log.debug({ command, userId }, 'Cleared cooldown');
  }

  // ========== Session Operations ==========

  /**
   * Set a session for a user
   */
  async setSession(
    type: string,
    userId: string,
    data: Record<string, unknown>,
    ttlMs: number
  ): Promise<void> {
    const key = `sess:${type}:${userId}`;
    const session: SessionData = {
      type,
      userId,
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    await this.set(key, JSON.stringify(session), ttlMs);
    this.log.debug({ type, userId, ttlMs }, 'Set session');
  }

  /**
   * Get a session for a user
   */
  async getSession(type: string, userId: string): Promise<SessionData | null> {
    const key = `sess:${type}:${userId}`;
    const value = await this.get(key);

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as SessionData;
    } catch {
      this.log.warn({ type, userId }, 'Failed to parse session data');
      return null;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(type: string, userId: string): Promise<void> {
    const key = `sess:${type}:${userId}`;
    await this.delete(key);
    this.log.debug({ type, userId }, 'Deleted session');
  }

  /**
   * Update session data (preserves TTL)
   */
  async updateSession(
    type: string,
    userId: string,
    updateFn: (data: Record<string, unknown>) => Record<string, unknown>
  ): Promise<boolean> {
    const session = await this.getSession(type, userId);
    if (!session) {
      return false;
    }

    const remainingTtl = session.expiresAt - Date.now();
    if (remainingTtl <= 0) {
      return false;
    }

    session.data = updateFn(session.data);
    await this.setSession(type, userId, session.data, remainingTtl);
    return true;
  }

  // ========== Rate Limiting ==========

  /**
   * Increment a rate limit counter with sliding window
   * Returns the current count
   */
  async incrementRateLimit(
    identifier: string,
    windowMs: number
  ): Promise<number> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }

    const key = `rl:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Use a sorted set with timestamps as scores
    // Remove old entries and add new one in a pipeline
    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    pipeline.zadd(key, now, `${now}`);
    pipeline.zcard(key);
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();
    if (!results) {
      throw new Error('Pipeline execution failed');
    }

    // zcard result is at index 2
    const count = results[2]?.[1] as number;
    return count ?? 0;
  }

  /**
   * Get current rate limit count
   */
  async getRateLimitCount(identifier: string, windowMs: number): Promise<number> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }

    const key = `rl:${identifier}`;
    const windowStart = Date.now() - windowMs;

    await this.client.zremrangebyscore(key, '-inf', windowStart);
    const count = await this.client.zcard(key);
    return count;
  }

  // ========== Sorted Set Operations (Sprint S-7) ==========

  /**
   * Remove members from sorted set by score range
   */
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    return this.client.zremrangebyscore(key, min, max);
  }

  /**
   * Get cardinality of sorted set
   */
  async zcard(key: string): Promise<number> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    return this.client.zcard(key);
  }

  /**
   * Add member to sorted set with score
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    return this.client.zadd(key, score, member);
  }

  /**
   * Get members from sorted set by score range
   */
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    offset?: number,
    count?: number
  ): Promise<string[]> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    if (offset !== undefined && count !== undefined) {
      return this.client.zrangebyscore(key, min, max, 'LIMIT', offset, count);
    }
    return this.client.zrangebyscore(key, min, max);
  }

  /**
   * Set key expiry in seconds
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  // ========== Pub/Sub Operations (Sprint S-7: Config Hot-Reload) ==========

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: string): Promise<number> {
    if (!this.client) {
      throw new Error('Redis not connected');
    }
    return this.client.publish(channel, message);
  }

  /**
   * Subscribe to channel
   * Returns unsubscribe function
   */
  subscribe(channel: string, callback: (message: string) => void): () => void {
    if (!this.client) {
      throw new Error('Redis not connected');
    }

    // Create duplicate connection for subscription
    const subClient = this.client.duplicate();

    subClient.subscribe(channel).catch((err) => {
      this.log.error({ error: err, channel }, 'Failed to subscribe');
    });

    subClient.on('message', (ch: string, msg: string) => {
      if (ch === channel) {
        callback(msg);
      }
    });

    // Return unsubscribe function
    return () => {
      subClient.unsubscribe(channel).then(() => {
        subClient.quit().catch(() => {});
      }).catch(() => {});
    };
  }
}

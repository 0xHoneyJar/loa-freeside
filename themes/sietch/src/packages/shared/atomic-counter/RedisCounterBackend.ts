/**
 * Redis Counter Backend
 *
 * Atomic INCRBY with midnight UTC TTL via Lua script.
 * Uses the IRedisClient interface for compatibility with ioredis and node-redis.
 *
 * @module packages/shared/atomic-counter/RedisCounterBackend
 */

import type { ICounterBackend, IRedisClient } from './types.js';

// =============================================================================
// Lua Script
// =============================================================================

/**
 * Atomic INCRBY + EXPIREAT on first write.
 * Detects new key by comparing result to the increment value.
 */
const INCRBY_EXPIREAT_LUA = `
local newval = redis.call('INCRBY', KEYS[1], ARGV[1])
if newval == tonumber(ARGV[1]) then
  redis.call('EXPIREAT', KEYS[1], ARGV[2])
end
return newval
`;

// =============================================================================
// Implementation
// =============================================================================

export class RedisCounterBackend implements ICounterBackend {
  private redis: IRedisClient;
  private keyPrefix: string;

  constructor(redis: IRedisClient, keyPrefix = 'billing:counter:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async increment(key: string, amount: bigint): Promise<bigint> {
    const redisKey = `${this.keyPrefix}${key}`;
    const incrementNum = Number(amount);
    const midnightEpoch = this.midnightUtcEpoch();

    // Prefer atomic Lua script: INCRBY + EXPIREAT on first write
    if (this.redis.eval) {
      const result = await this.redis.eval(
        INCRBY_EXPIREAT_LUA,
        1,
        redisKey,
        incrementNum,
        midnightEpoch,
      );
      return BigInt(result as number);
    }

    // Fallback: separate INCRBY + EXPIRE
    if (this.redis.incrby) {
      const newVal = await this.redis.incrby(redisKey, incrementNum);
      if (newVal === incrementNum && this.redis.expire) {
        await this.redis.expire(redisKey, this.secondsUntilMidnightUtc());
      }
      return BigInt(newVal);
    }

    // Last resort: GET + SET (not atomic under concurrency)
    const current = await this.redis.get(redisKey);
    const newTotal = (current ? BigInt(current) : 0n) + amount;
    const ttl = this.secondsUntilMidnightUtc();
    if (this.redis.setex) {
      await this.redis.setex(redisKey, ttl, newTotal.toString());
    } else {
      await this.redis.set(redisKey, newTotal.toString());
      if (this.redis.expire) {
        await this.redis.expire(redisKey, ttl);
      }
    }
    return newTotal;
  }

  async get(key: string): Promise<bigint> {
    const redisKey = `${this.keyPrefix}${key}`;
    const val = await this.redis.get(redisKey);
    if (val === null) {
      // Throw on cache miss so the counter chain falls through
      // to persistent backends (SQLite, InMemory).
      throw new Error(`Redis cache miss: ${redisKey}`);
    }
    return BigInt(val);
  }

  async reset(key: string): Promise<void> {
    const redisKey = `${this.keyPrefix}${key}`;
    await this.redis.set(redisKey, '0');
  }

  private secondsUntilMidnightUtc(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
    ));
    return Math.max(1, Math.floor((midnight.getTime() - now.getTime()) / 1000));
  }

  private midnightUtcEpoch(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
    ));
    return Math.floor(midnight.getTime() / 1000);
  }
}

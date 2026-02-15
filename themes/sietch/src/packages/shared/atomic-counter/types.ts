/**
 * Atomic Counter Types
 *
 * Core interfaces for the counter primitive. Implementations are in separate files.
 *
 * @module packages/shared/atomic-counter/types
 */

// =============================================================================
// Counter Backend Interface
// =============================================================================

/**
 * Backend interface for atomic counter operations.
 * Implementations: Redis (cache + TTL), SQLite (persistent), InMemory (test).
 */
export interface ICounterBackend {
  /** Atomically increment counter, returns new total */
  increment(key: string, amount: bigint): Promise<bigint>;
  /** Get current counter value (0n if not set) */
  get(key: string): Promise<bigint>;
  /** Reset counter to zero */
  reset(key: string): Promise<void>;
}

// =============================================================================
// Atomic Counter Interface
// =============================================================================

export interface IAtomicCounter {
  /** Atomically increment counter via backend chain, returns new total */
  increment(key: string, amount: bigint): Promise<bigint>;
  /** Get current counter value via backend chain (0n if not set) */
  get(key: string): Promise<bigint>;
  /** Reset counter across all backends */
  reset(key: string): Promise<void>;
}

// =============================================================================
// Configuration
// =============================================================================

export interface AtomicCounterConfig {
  /** Primary backend (e.g., Redis for fast cache) */
  primary: ICounterBackend;
  /** Fallback if primary fails (e.g., SQLite for persistence) */
  fallback?: ICounterBackend;
  /** Last resort if both fail (e.g., InMemory for test mode) */
  bootstrap?: ICounterBackend;
}

// =============================================================================
// Redis Client Interface
// =============================================================================

/**
 * Minimal Redis client interface for counter operations.
 * Compatible with ioredis and node-redis clients.
 *
 * Extracted from AgentWalletPrototype's AgentRedisClient to decouple
 * the counter package from billing-specific types.
 */
export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  /** Set key with TTL in seconds */
  setex?(key: string, seconds: number, value: string): Promise<string>;
  expire?(key: string, seconds: number): Promise<number>;
  /** Atomic increment — returns new value after increment */
  incrby?(key: string, increment: number): Promise<number>;
  /** Execute Lua script for atomic INCRBY + EXPIREAT */
  eval?(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
}

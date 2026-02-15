/**
 * Atomic Counter — Shared Counter Primitive
 *
 * Domain-agnostic atomic counter with backend chain (primary → fallback → bootstrap).
 * Originally extracted from AgentWalletPrototype's daily spending counter,
 * now shared across services for rate-limiting and spending-tracking.
 *
 * Sprint refs: Sprint 254 Task 3.1 (extraction from core/protocol/atomic-counter)
 *
 * @module packages/shared/atomic-counter
 */

// Core interfaces and factory
export type {
  ICounterBackend,
  IAtomicCounter,
  AtomicCounterConfig,
} from './types.js';

export { createAtomicCounter } from './factory.js';

// Redis client interface (extracted from AgentWalletPrototype)
export type { IRedisClient } from './types.js';

// Backend implementations
export { InMemoryCounterBackend } from './InMemoryCounterBackend.js';
export { SqliteCounterBackend } from './SqliteCounterBackend.js';
export { RedisCounterBackend } from './RedisCounterBackend.js';

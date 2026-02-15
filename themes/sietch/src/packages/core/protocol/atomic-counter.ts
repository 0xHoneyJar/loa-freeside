/**
 * Atomic Counter — Shared Counter Primitive
 *
 * Defines the ICounterBackend interface and factory for creating
 * atomic counters with fallback chains (primary → fallback → bootstrap).
 *
 * Extracted from AgentWalletPrototype's 3-layer daily spending counter.
 *
 * EXTRACTION CANDIDATE (Bridge Review, strategic finding strategic-2):
 * This module and its backends (InMemory, SQLite, Redis) are domain-agnostic.
 * Moving to packages/shared/atomic-counter/ would allow loa-finn, gateway,
 * and future services to reuse the same rate-limiting and spending-tracking
 * primitives without reimplementation. The interface is already clean and
 * the implementations have zero billing-specific dependencies.
 *
 * Sprint refs: Task 2.1
 *
 * @module packages/core/protocol/atomic-counter
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
// Factory
// =============================================================================

/**
 * Create an atomic counter with a backend chain.
 *
 * Increment: tries primary, on failure tries fallback, then bootstrap.
 * Get: tries primary, on failure tries fallback, then bootstrap.
 * Reset: resets ALL backends (best-effort, does not throw).
 */
export function createAtomicCounter(config: AtomicCounterConfig): IAtomicCounter {
  const backends: ICounterBackend[] = [config.primary];
  if (config.fallback) backends.push(config.fallback);
  if (config.bootstrap) backends.push(config.bootstrap);

  return {
    async increment(key: string, amount: bigint): Promise<bigint> {
      let lastError: unknown;
      for (const backend of backends) {
        try {
          return await backend.increment(key, amount);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    },

    async get(key: string): Promise<bigint> {
      let lastError: unknown;
      for (const backend of backends) {
        try {
          return await backend.get(key);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    },

    async reset(key: string): Promise<void> {
      for (const backend of backends) {
        try {
          await backend.reset(key);
        } catch {
          // Best-effort — continue to next backend
        }
      }
    },
  };
}

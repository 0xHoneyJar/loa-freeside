/**
 * Atomic Counter Factory
 *
 * Creates a counter with a backend chain (primary → fallback → bootstrap).
 *
 * @module packages/shared/atomic-counter/factory
 */

import type { ICounterBackend, IAtomicCounter, AtomicCounterConfig } from './types.js';

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

/**
 * In-Memory Counter Backend
 *
 * Map-based counter for test/prototype mode.
 * Thread-safe within single Node.js event loop (Map operations are synchronous).
 *
 * @module packages/shared/atomic-counter/InMemoryCounterBackend
 */

import type { ICounterBackend } from './types.js';

export class InMemoryCounterBackend implements ICounterBackend {
  private counters: Map<string, bigint> = new Map();

  async increment(key: string, amount: bigint): Promise<bigint> {
    const current = this.counters.get(key) ?? 0n;
    const newTotal = current + amount;
    this.counters.set(key, newTotal);
    return newTotal;
  }

  async get(key: string): Promise<bigint> {
    return this.counters.get(key) ?? 0n;
  }

  async reset(key: string): Promise<void> {
    this.counters.delete(key);
  }
}

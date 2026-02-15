/**
 * Counter Backends — Re-export from Shared Package
 *
 * This module re-exports from packages/shared/atomic-counter for backward
 * compatibility. New consumers should import from the shared package directly.
 *
 * Sprint 254 Task 3.3: Extraction to shared package
 *
 * @module packages/adapters/billing/counters
 */

export { RedisCounterBackend } from '../../../shared/atomic-counter/RedisCounterBackend.js';
export { SqliteCounterBackend } from '../../../shared/atomic-counter/SqliteCounterBackend.js';
export { InMemoryCounterBackend } from '../../../shared/atomic-counter/InMemoryCounterBackend.js';

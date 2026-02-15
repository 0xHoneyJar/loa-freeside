/**
 * Atomic Counter — Re-export from Shared Package
 *
 * This module re-exports from packages/shared/atomic-counter for backward
 * compatibility. New consumers should import from the shared package directly.
 *
 * Sprint 254 Task 3.2: Extraction to shared package
 *
 * @module packages/core/protocol/atomic-counter
 */

export type {
  ICounterBackend,
  IAtomicCounter,
  AtomicCounterConfig,
} from '../../shared/atomic-counter/types.js';

export { createAtomicCounter } from '../../shared/atomic-counter/factory.js';

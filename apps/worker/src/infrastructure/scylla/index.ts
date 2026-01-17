/**
 * ScyllaDB Module
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * Exports the ScyllaDB client implementation with metrics.
 */

export { ScyllaClient } from './scylla-client.js';
export { ScyllaMetrics } from './metrics.js';
export {
  type ScyllaConfig,
  type Score,
  type ScoreHistoryEntry,
  type LeaderboardEntry,
  type EligibilitySnapshot,
  type PaginatedResult,
  type BatchResult,
  type LeaderboardType,
  type ScoreEventType,
  DEFAULT_SCYLLA_CONFIG,
} from './types.js';

/**
 * ScyllaDB Types
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * Type definitions for ScyllaDB operations
 */

/**
 * ScyllaDB connection configuration
 */
export interface ScyllaConfig {
  /** Secure connect bundle path (for cloud) */
  bundlePath?: string;
  /** Contact points (for self-hosted) */
  contactPoints?: string[];
  /** Local datacenter for consistency */
  localDataCenter: string;
  /** Keyspace name */
  keyspace: string;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;
  /** Connection pool size */
  poolSize?: number;
  /** Request timeout in ms */
  requestTimeout?: number;
}

/**
 * Score record
 */
export interface Score {
  communityId: string;
  profileId: string;
  convictionScore: string; // Decimal as string for precision
  activityScore: string;
  currentRank: number;
  updatedAt: Date;
}

/**
 * Score history entry
 */
export interface ScoreHistoryEntry {
  communityId: string;
  profileId: string;
  day: string; // YYYY-MM-DD
  eventTime: Date;
  scoreBefore: string;
  scoreAfter: string;
  delta: string;
  eventType: string;
  txHash?: string;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  communityId: string;
  leaderboardType: string;
  bucket: number;
  rank: number;
  profileId: string;
  displayName: string;
  score: string;
  tier: string;
  updatedAt: Date;
}

/**
 * Eligibility snapshot
 */
export interface EligibilitySnapshot {
  communityId: string;
  profileId: string;
  walletAddress: string;
  ruleId: string;
  isEligible: boolean;
  tokenBalance: string;
  checkedAt: Date;
  blockNumber: bigint;
}

/**
 * Query result with pagination
 */
export interface PaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  nextPageState?: string;
}

/**
 * Batch operation result
 */
export interface BatchResult {
  success: number;
  failed: number;
  errors: Error[];
}

/**
 * Default ScyllaDB configuration
 */
export const DEFAULT_SCYLLA_CONFIG: Partial<ScyllaConfig> = {
  localDataCenter: 'aws-us-east-1',
  keyspace: 'arrakis',
  poolSize: 4,
  requestTimeout: 10000,
};

/**
 * Leaderboard types
 */
export type LeaderboardType = 'conviction' | 'activity' | 'badges';

/**
 * Score event types
 */
export type ScoreEventType =
  | 'token_hold'
  | 'nft_ownership'
  | 'activity_bonus'
  | 'manual_adjustment'
  | 'decay'
  | 'migration';

/**
 * IChainProvider - Two-Tier Chain Provider Interfaces
 *
 * Sprint 34: Foundation - Phase 0 of SaaS transformation
 *
 * Architecture:
 * - Tier 1 (INativeReader): Binary checks via direct viem RPC
 * - Tier 2 (IScoreService): Complex queries via Score Service API
 * - IChainProvider: Orchestrates both tiers with graceful degradation
 *
 * @module packages/core/ports/IChainProvider
 */

import type { Address } from 'viem';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Token types supported by the chain provider
 */
export type TokenType = 'native' | 'erc20' | 'erc721' | 'erc1155';

/**
 * Token specification for balance/ownership checks
 */
export interface TokenSpec {
  /** Token type */
  type: TokenType;
  /** Contract address (null for native token) */
  address: Address | null;
  /** Chain ID */
  chainId: number;
  /** Token ID for ERC721/ERC1155 */
  tokenId?: bigint;
}

/**
 * Basic eligibility criteria for Tier 1 (Native) checks
 * These are binary checks that return true/false
 */
export interface BasicEligibilityCriteria {
  /** Minimum token balance required */
  minBalance?: {
    token: TokenSpec;
    amount: bigint;
  };
  /** NFT ownership requirement */
  nftOwnership?: {
    collection: Address;
    chainId: number;
    /** Specific token IDs (empty = any token in collection) */
    tokenIds?: bigint[];
  };
}

/**
 * Advanced eligibility criteria for Tier 2 (Score Service) checks
 * These require complex queries and historical data
 */
export interface AdvancedEligibilityCriteria {
  /** Minimum rank in leaderboard */
  minRank?: number;
  /** Maximum rank in leaderboard */
  maxRank?: number;
  /** Minimum conviction score */
  minConvictionScore?: number;
  /** Minimum activity score */
  minActivityScore?: number;
  /** Time-weighted requirements */
  timeWeighted?: {
    /** Minimum holding period in days */
    minHoldingDays: number;
    /** Minimum average balance over period */
    minAverageBalance: bigint;
  };
}

/**
 * Result of an eligibility check
 */
export interface EligibilityResult {
  /** Whether the address meets the criteria */
  eligible: boolean;
  /** Data source for the result */
  source: 'native' | 'score' | 'cached' | 'degraded';
  /** Timestamp when result was determined */
  timestamp: Date;
  /** Additional context for the result */
  context?: {
    /** Current balance (if balance check) */
    balance?: bigint;
    /** Whether NFT is owned (if NFT check) */
    ownsNft?: boolean;
    /** Current rank (if rank check) */
    rank?: number;
    /** Conviction score (if score check) */
    convictionScore?: number;
  };
  /** Error message if check failed but returned degraded result */
  error?: string;
}

// =============================================================================
// Tier 1: Native Reader Interface
// =============================================================================

/**
 * INativeReader - Tier 1 Direct Blockchain Queries
 *
 * Binary checks that work without any external dependencies.
 * These methods ALWAYS work as long as RPC is available.
 *
 * Implementation: NativeBlockchainReader (viem)
 */
export interface INativeReader {
  /**
   * Check if address has at least minAmount of token
   *
   * @param address - Wallet address to check
   * @param token - Token specification
   * @param minAmount - Minimum balance required
   * @returns true if balance >= minAmount
   *
   * @example
   * ```typescript
   * const hasBgt = await reader.hasBalance(
   *   '0x1234...',
   *   { type: 'erc20', address: BGT_ADDRESS, chainId: 80084 },
   *   parseEther('100')
   * );
   * ```
   */
  hasBalance(address: Address, token: TokenSpec, minAmount: bigint): Promise<boolean>;

  /**
   * Check if address owns any token from NFT collection
   *
   * @param address - Wallet address to check
   * @param collection - NFT collection contract address
   * @param chainId - Chain ID for the collection
   * @param tokenIds - Optional specific token IDs to check (empty = any)
   * @returns true if address owns at least one matching NFT
   */
  ownsNFT(
    address: Address,
    collection: Address,
    chainId: number,
    tokenIds?: bigint[]
  ): Promise<boolean>;

  /**
   * Get exact token balance for address
   *
   * @param address - Wallet address
   * @param token - Token specification
   * @returns Current balance as bigint
   */
  getBalance(address: Address, token: TokenSpec): Promise<bigint>;

  /**
   * Get NFT balance (count of tokens owned)
   *
   * @param address - Wallet address
   * @param collection - NFT collection contract address
   * @param chainId - Chain ID
   * @returns Number of NFTs owned
   */
  getNFTBalance(address: Address, collection: Address, chainId: number): Promise<bigint>;

  /**
   * Check if the reader is healthy (RPC responding)
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get current block number
   */
  getCurrentBlock(): Promise<bigint>;
}

// =============================================================================
// Tier 2: Score Service Interface
// =============================================================================

/**
 * Score data returned from Score Service
 */
export interface ScoreData {
  /** Wallet address */
  address: Address;
  /** Current rank in leaderboard (1 = highest) */
  rank: number;
  /** Conviction score (0-1000) */
  convictionScore: number;
  /** Activity score (0-100) */
  activityScore: number;
  /** Total BGT held (wei) */
  totalBgtHeld: bigint;
  /** Total BGT claimed (wei) */
  totalBgtClaimed: bigint;
  /** Total BGT burned (wei) */
  totalBgtBurned: bigint;
  /** Time-weighted average balance */
  timeWeightedBalance: bigint;
  /** First claim timestamp */
  firstClaimAt: Date | null;
  /** Last activity timestamp */
  lastActivityAt: Date | null;
  /** Data freshness timestamp */
  updatedAt: Date;
}

/**
 * Leaderboard entry from Score Service
 */
export interface LeaderboardEntry {
  rank: number;
  address: Address;
  convictionScore: number;
  totalBgtHeld: bigint;
}

/**
 * IScoreService - Tier 2 Score Service API
 *
 * Complex queries that require aggregated/historical data.
 * May fail - callers should handle degradation gracefully.
 *
 * Implementation: ScoreServiceAdapter (HTTP client with circuit breaker)
 */
export interface IScoreService {
  /**
   * Get score data for a single address
   *
   * @param address - Wallet address
   * @throws Error if Score Service is unavailable
   */
  getScore(address: Address): Promise<ScoreData>;

  /**
   * Get scores for multiple addresses (batch)
   *
   * @param addresses - Array of wallet addresses
   * @returns Map of address to score data
   * @throws Error if Score Service is unavailable
   */
  getScores(addresses: Address[]): Promise<Map<Address, ScoreData>>;

  /**
   * Get leaderboard (top N addresses by conviction score)
   *
   * @param limit - Number of entries to return (default 100)
   * @param offset - Offset for pagination
   */
  getLeaderboard(limit?: number, offset?: number): Promise<LeaderboardEntry[]>;

  /**
   * Get rank for a specific address
   *
   * @param address - Wallet address
   * @returns Rank (1 = highest) or null if not ranked
   */
  getRank(address: Address): Promise<number | null>;

  /**
   * Check if Score Service is healthy
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get last successful update timestamp
   */
  getLastUpdate(): Promise<Date | null>;
}

// =============================================================================
// Combined Chain Provider Interface
// =============================================================================

/**
 * Degradation mode when Score Service is unavailable
 */
export type DegradationMode =
  | 'full' // All features available
  | 'partial' // Only Tier 1 (native) features available
  | 'cached'; // Using stale cached data

/**
 * Chain provider status
 */
export interface ChainProviderStatus {
  /** Current degradation mode */
  mode: DegradationMode;
  /** Is Tier 1 (native) healthy? */
  nativeHealthy: boolean;
  /** Is Tier 2 (score) healthy? */
  scoreHealthy: boolean;
  /** Circuit breaker state for score service */
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  /** Last successful score query timestamp */
  lastScoreSuccess: Date | null;
  /** Cache age in seconds (null if no cache) */
  cacheAgeSeconds: number | null;
}

/**
 * IChainProvider - Two-Tier Chain Provider
 *
 * Orchestrates Tier 1 (Native) and Tier 2 (Score) with graceful degradation.
 *
 * Behavior:
 * - checkBasicEligibility: Uses ONLY Tier 1, always available
 * - checkAdvancedEligibility: Uses Tier 2, falls back to cached data
 * - getStatus: Returns current health/degradation status
 *
 * Implementation: TwoTierChainProvider
 */
export interface IChainProvider {
  /**
   * Check basic eligibility using Tier 1 (Native Reader)
   *
   * This method ALWAYS works as long as RPC is available.
   * No external dependencies required.
   *
   * @param address - Wallet address to check
   * @param criteria - Basic eligibility criteria (balance/NFT checks)
   */
  checkBasicEligibility(
    address: Address,
    criteria: BasicEligibilityCriteria
  ): Promise<EligibilityResult>;

  /**
   * Check advanced eligibility using Tier 2 (Score Service)
   *
   * This method may fail if Score Service is unavailable.
   * Falls back to cached data or returns degraded result.
   *
   * @param address - Wallet address to check
   * @param criteria - Advanced eligibility criteria (rank/score checks)
   */
  checkAdvancedEligibility(
    address: Address,
    criteria: AdvancedEligibilityCriteria
  ): Promise<EligibilityResult>;

  /**
   * Get score data for an address
   *
   * Delegates to Score Service with circuit breaker protection.
   *
   * @param address - Wallet address
   * @returns Score data or null if unavailable
   */
  getScoreData(address: Address): Promise<ScoreData | null>;

  /**
   * Get current chain provider status
   */
  getStatus(): Promise<ChainProviderStatus>;

  /**
   * Get the underlying native reader for direct access
   */
  getNativeReader(): INativeReader;

  /**
   * Get the underlying score service for direct access
   * May return null if score service is completely unavailable
   */
  getScoreService(): IScoreService | null;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Configuration for native reader
 */
export interface NativeReaderConfig {
  /** RPC URLs (will use fallback) */
  rpcUrls: string[];
  /** Chain ID */
  chainId: number;
  /** Request timeout in ms */
  timeout?: number;
  /** Retry count per RPC */
  retryCount?: number;
}

/**
 * Configuration for score service adapter
 */
export interface ScoreServiceConfig {
  /** Score Service API base URL */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Circuit breaker error threshold (0-1) */
  errorThreshold?: number;
  /** Circuit breaker reset timeout in ms */
  resetTimeout?: number;
}

/**
 * Configuration for two-tier chain provider
 */
export interface ChainProviderConfig {
  /** Native reader configuration */
  native: NativeReaderConfig;
  /** Score service configuration */
  score: ScoreServiceConfig;
  /** Cache TTL in seconds for score data */
  cacheTtlSeconds?: number;
}

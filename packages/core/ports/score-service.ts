/**
 * Score Service Protocol Types
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * TypeScript type definitions for the Score Service gRPC protocol.
 * These types mirror the proto definitions in apps/score-service/proto/score.proto
 * and are used by the TypeScript client to communicate with the Rust Score Service.
 *
 * @see SDD §6.1.4 Score Service (Rust Microservice)
 */

// --------------------------------------------------------------------------
// Request Types
// --------------------------------------------------------------------------

/**
 * Request for getting ranked holders of an asset
 */
export interface RankedHoldersRequest {
  /** Community ID (guild ID) */
  communityId: string;
  /** Asset type: "token" | "nft" */
  assetType: 'token' | 'nft';
  /** Contract address of the asset */
  contractAddress: string;
  /** Chain ID (e.g., "80094" for Berachain) */
  chainId: string;
  /** Maximum number of holders to return */
  limit: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Request for getting a specific address's rank
 */
export interface AddressRankRequest {
  /** Community ID (guild ID) */
  communityId: string;
  /** Wallet address to check */
  address: string;
  /** Asset type: "token" | "nft" */
  assetType: 'token' | 'nft';
  /** Contract address of the asset */
  contractAddress: string;
  /** Chain ID (e.g., "80094" for Berachain) */
  chainId: string;
}

/**
 * Request for checking action history
 */
export interface ActionHistoryRequest {
  /** Wallet address to check */
  address: string;
  /** Action type to check for */
  action: string;
  /** Optional protocol/contract filter */
  protocol?: string;
  /** Minimum times action was performed */
  minCount?: number;
  /** Time window in seconds (0 = all time) */
  timeWindowSeconds?: number;
}

/**
 * Request for cross-chain aggregated score
 */
export interface CrossChainScoreRequest {
  /** Wallet address to check */
  address: string;
  /** Chain IDs to aggregate across */
  chainIds: string[];
  /** Optional community ID for context */
  communityId?: string;
}

/**
 * Health check request
 */
export interface HealthCheckRequest {
  /** Optional service name to check */
  service?: string;
}

// --------------------------------------------------------------------------
// Response Types
// --------------------------------------------------------------------------

/**
 * Single ranked holder in the response
 */
export interface RankedHolderProto {
  /** Wallet address */
  address: string;
  /** Rank position (1-indexed) */
  rank: number;
  /** Score value as decimal string */
  score: string;
  /** Balance as BigInt string */
  balance: string;
}

/**
 * Response for ranked holders request
 */
export interface RankedHoldersResponse {
  /** List of ranked holders */
  holders: RankedHolderProto[];
  /** Total count of holders (for pagination) */
  totalCount: number;
  /** Unix timestamp when this was computed */
  computedAt: number;
}

/**
 * Response for address rank request
 */
export interface AddressRankResponse {
  /** Rank position (0 if not ranked) */
  rank: number;
  /** Score value as decimal string */
  score: string;
  /** Total number of holders */
  totalHolders: number;
  /** Whether the address was found */
  found: boolean;
}

/**
 * Response for action history check
 */
export interface ActionHistoryResponse {
  /** Whether the action criteria was met */
  hasPerformed: boolean;
  /** Number of times action was performed */
  count: number;
  /** Timestamp of last action (if any) */
  lastPerformedAt?: number;
}

/**
 * Per-chain score breakdown
 */
export interface ChainScore {
  /** Chain ID */
  chainId: string;
  /** Score on this chain */
  score: string;
}

/**
 * Response for cross-chain score request
 */
export interface CrossChainScoreResponse {
  /** Wallet address */
  address: string;
  /** Aggregated total score */
  totalScore: string;
  /** Per-chain breakdown */
  chainScores: ChainScore[];
  /** Unix timestamp when computed */
  computedAt: number;
}

/**
 * Health check status
 */
export type HealthStatus = 'SERVING' | 'NOT_SERVING' | 'UNKNOWN';

/**
 * Response for health check
 */
export interface HealthCheckResponse {
  /** Service health status */
  status: HealthStatus;
  /** Optional message */
  message?: string;
}

// --------------------------------------------------------------------------
// Score Service Client Interface
// --------------------------------------------------------------------------

/**
 * Score Service Client Interface
 *
 * Defines the contract for communicating with the Score Service (Tier 2).
 * Implementations should handle connection management, retries, and error handling.
 */
export interface IScoreServiceClient {
  /**
   * Get ranked holders for an asset
   *
   * @param request - Ranked holders request
   * @returns Ranked holders response
   * @throws Error if service is unavailable
   */
  getRankedHolders(request: RankedHoldersRequest): Promise<RankedHoldersResponse>;

  /**
   * Get the rank of a specific address
   *
   * @param request - Address rank request
   * @returns Address rank response
   * @throws Error if service is unavailable
   */
  getAddressRank(request: AddressRankRequest): Promise<AddressRankResponse>;

  /**
   * Check if an address has performed a specific action
   *
   * @param request - Action history request
   * @returns Action history response
   * @throws Error if service is unavailable
   */
  checkActionHistory(request: ActionHistoryRequest): Promise<ActionHistoryResponse>;

  /**
   * Get aggregated score across multiple chains
   *
   * @param request - Cross-chain score request
   * @returns Cross-chain score response
   * @throws Error if service is unavailable
   */
  getCrossChainScore(request: CrossChainScoreRequest): Promise<CrossChainScoreResponse>;

  /**
   * Check if the Score Service is healthy
   *
   * @param request - Optional health check request
   * @returns Health check response
   */
  healthCheck(request?: HealthCheckRequest): Promise<HealthCheckResponse>;

  /**
   * Check if the client is connected to the Score Service
   *
   * @returns True if connected
   */
  isConnected(): boolean;

  /**
   * Get the current circuit breaker state
   *
   * @returns Circuit breaker state
   */
  getCircuitState(): 'closed' | 'open' | 'halfOpen';

  /**
   * Close the client connection gracefully
   */
  close(): Promise<void>;
}

// --------------------------------------------------------------------------
// Configuration Types
// --------------------------------------------------------------------------

/**
 * Score Service client configuration
 */
export interface ScoreServiceClientConfig {
  /** Score Service endpoint URL (e.g., "http://score-service:50051") */
  endpoint: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Circuit breaker: error threshold percentage (0-100) */
  errorThresholdPercentage?: number;
  /** Circuit breaker: reset timeout in milliseconds */
  resetTimeoutMs?: number;
  /** Circuit breaker: minimum volume threshold */
  volumeThreshold?: number;
  /** Enable TLS for connection */
  useTls?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry backoff multiplier */
  retryBackoffMs?: number;
}

/**
 * Default Score Service client configuration
 */
export const DEFAULT_SCORE_SERVICE_CONFIG: Required<Omit<ScoreServiceClientConfig, 'endpoint'>> = {
  timeoutMs: 5_000, // 5s timeout per SDD §6.1.5
  errorThresholdPercentage: 50, // Trip at 50% error rate
  resetTimeoutMs: 30_000, // 30s reset timeout
  volumeThreshold: 10, // Minimum requests before tripping
  useTls: false,
  maxRetries: 2,
  retryBackoffMs: 100,
};

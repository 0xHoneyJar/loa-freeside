/**
 * Two-Tier Chain Provider
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * Orchestrator that combines Tier 1 (Native Reader) and Tier 2 (Score Service)
 * for comprehensive blockchain data access with graceful degradation.
 *
 * Features:
 * - Tier 1 (Native Reader): Always available for binary checks
 * - Tier 2 (Score Service): Complex queries with circuit breaker protection
 * - Graceful degradation when Tier 2 is unavailable
 * - Prometheus metrics for observability
 *
 * @see SDD §6.1.5 Two-Tier Orchestrator
 * @see SDD §6.1.6 Degradation Matrix
 */

import CircuitBreaker from 'opossum';
import type { Logger } from 'pino';
import type {
  IChainProvider,
  Address,
  ChainId,
  AssetConfig,
  RankedHolder,
  CrossChainScore,
  ActionHistoryConfig,
  EligibilityResult,
} from '../../core/ports/chain-provider.js';
import type { IScoreServiceClient } from '../../core/ports/score-service.js';
import type { NativeBlockchainReader } from './native-reader.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Eligibility rule definition
 *
 * Used by checkBasicEligibility and checkAdvancedEligibility
 */
export interface EligibilityRule {
  /** Unique rule identifier */
  id: string;
  /** Community ID (guild ID) */
  communityId: string;
  /** Rule type */
  ruleType: 'token_balance' | 'nft_ownership' | 'score_threshold' | 'activity_check';
  /** Chain ID where the asset resides */
  chainId: ChainId;
  /** Contract address (for token/nft) */
  contractAddress: Address;
  /** Rule parameters */
  parameters: EligibilityRuleParameters;
}

/**
 * Eligibility rule parameters
 */
export interface EligibilityRuleParameters {
  /** Minimum balance (for token_balance) */
  minAmount?: string;
  /** Token ID (for nft_ownership) */
  tokenId?: string;
  /** Asset type (for score_threshold) */
  assetType?: 'token' | 'nft';
  /** Maximum rank to be eligible (for score_threshold) */
  maxRank?: number;
  /** Action type (for activity_check) */
  actionType?: string;
}

/** Circuit breaker state */
type CircuitState = 'closed' | 'open' | 'halfOpen';

/**
 * Metrics interface for Prometheus integration
 */
export interface TwoTierProviderMetrics {
  /** Record eligibility check result */
  recordEligibilityCheck(
    ruleType: string,
    source: string,
    eligible: boolean,
    latencyMs: number
  ): void;
  /** Record circuit breaker state change */
  recordCircuitState(service: string, state: number): void;
  /** Record degradation event */
  recordDegradation(ruleType: string, reason: string): void;
}

/**
 * Multi-layer cache interface (simplified for this adapter)
 */
export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>;
}

/**
 * Simple in-memory cache implementation
 */
export class InMemoryCache implements ICache {
  private cache: Map<string, { value: unknown; expiresAt: number }> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void> {
    const ttl = options?.ttl ?? 300_000; // Default 5 minutes
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// --------------------------------------------------------------------------
// Two-Tier Chain Provider Implementation
// --------------------------------------------------------------------------

/**
 * Two-Tier Chain Provider - Unified Blockchain Data Access
 *
 * Orchestrates Tier 1 (Native Reader) and Tier 2 (Score Service) to provide
 * comprehensive blockchain data access with automatic fallback.
 *
 * Degradation behavior:
 * - Token balance: Falls back to Native Reader (confidence: 1.0)
 * - NFT ownership: Falls back to Native Reader (confidence: 1.0)
 * - Rank threshold: Falls back to balance check (confidence: 0.5, permissive)
 * - Activity check: Falls back to cache or deny (confidence: 0.0-0.8)
 */
export class TwoTierChainProvider implements IChainProvider {
  private readonly log: Logger;
  private readonly scoreServiceBreaker: CircuitBreaker<unknown[], unknown>;

  // Default chain for single-chain operations
  private readonly defaultChainId: ChainId = 80094; // Berachain

  constructor(
    private readonly nativeReader: NativeBlockchainReader,
    private readonly scoreServiceClient: IScoreServiceClient,
    private readonly cache: ICache,
    private readonly metrics: TwoTierProviderMetrics | null,
    logger: Logger
  ) {
    this.log = logger.child({ component: 'TwoTierChainProvider' });

    // Initialize Score Service circuit breaker
    // Per SDD §6.1.5: 5s timeout, 50% error threshold, 30s reset
    this.scoreServiceBreaker = new CircuitBreaker(
      async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      {
        timeout: 5_000, // 5s timeout
        errorThresholdPercentage: 50, // Trip at 50% error rate
        resetTimeout: 30_000, // 30s reset
        volumeThreshold: 10, // Minimum requests before tripping
      }
    );

    // Circuit breaker event handlers
    this.scoreServiceBreaker.on('open', () => {
      this.log.warn('Score Service circuit breaker OPEN');
      this.metrics?.recordCircuitState('score_service', 2);
    });

    this.scoreServiceBreaker.on('halfOpen', () => {
      this.log.info('Score Service circuit breaker HALF-OPEN');
      this.metrics?.recordCircuitState('score_service', 1);
    });

    this.scoreServiceBreaker.on('close', () => {
      this.log.info('Score Service circuit breaker CLOSED');
      this.metrics?.recordCircuitState('score_service', 0);
    });

    this.log.info('TwoTierChainProvider initialized');
  }

  // --------------------------------------------------------------------------
  // Eligibility Check Methods
  // --------------------------------------------------------------------------

  /**
   * Basic eligibility check - Tier 1 only (always available)
   *
   * Uses Native Reader for direct RPC checks. Never fails due to Tier 2 issues.
   *
   * Supported rule types:
   * - token_balance: Check if address has minimum token balance
   * - nft_ownership: Check if address owns NFT (specific or any from collection)
   */
  async checkBasicEligibility(
    rule: EligibilityRule,
    address: Address
  ): Promise<EligibilityResult> {
    const start = Date.now();

    try {
      switch (rule.ruleType) {
        case 'token_balance': {
          const minAmount = BigInt(rule.parameters.minAmount ?? '0');
          const hasBalance = await this.nativeReader.hasBalance(
            rule.chainId,
            address,
            rule.contractAddress,
            minAmount
          );

          const result: EligibilityResult = {
            eligible: hasBalance,
            source: 'native',
            confidence: 1.0,
            details: {
              threshold: rule.parameters.minAmount,
            },
          };

          this.recordMetrics(rule.ruleType, result, start);
          return result;
        }

        case 'nft_ownership': {
          const tokenId = rule.parameters.tokenId
            ? BigInt(rule.parameters.tokenId)
            : undefined;
          const ownsNFT = await this.nativeReader.ownsNFT(
            rule.chainId,
            address,
            rule.contractAddress,
            tokenId
          );

          const result: EligibilityResult = {
            eligible: ownsNFT,
            source: 'native',
            confidence: 1.0,
            details: {},
          };

          this.recordMetrics(rule.ruleType, result, start);
          return result;
        }

        default:
          throw new Error(
            `Basic eligibility doesn't support rule type: ${rule.ruleType}. ` +
              `Use checkAdvancedEligibility for complex queries.`
          );
      }
    } catch (error) {
      this.log.error(
        { error: (error as Error).message, rule: rule.id, address },
        'Basic eligibility check failed'
      );
      throw error;
    }
  }

  /**
   * Advanced eligibility check - Tier 2 with Tier 1 fallback
   *
   * Attempts to use Score Service for complex queries. Falls back to
   * Native Reader with degraded results when Score Service is unavailable.
   *
   * Supported rule types:
   * - token_balance, nft_ownership: Delegates to checkBasicEligibility
   * - score_threshold: Uses Score Service for rank-based eligibility
   * - activity_check: Uses Score Service for action history checks
   */
  async checkAdvancedEligibility(
    rule: EligibilityRule,
    address: Address
  ): Promise<EligibilityResult> {
    const start = Date.now();

    // Delegate basic types to checkBasicEligibility
    if (rule.ruleType === 'token_balance' || rule.ruleType === 'nft_ownership') {
      return this.checkBasicEligibility(rule, address);
    }

    // Try Score Service with circuit breaker
    try {
      const result = await this.scoreServiceBreaker.fire(async () => {
        return this.checkViaScoreService(rule, address);
      });
      this.recordMetrics(rule.ruleType, result as EligibilityResult, start);
      return result as EligibilityResult;
    } catch (error) {
      this.log.warn(
        { error: (error as Error).message, rule: rule.id, address },
        'Score Service unavailable, using fallback'
      );
      this.metrics?.recordDegradation(rule.ruleType, (error as Error).message);

      // Fallback to degraded mode
      const result = await this.degradedFallback(rule, address);
      this.recordMetrics(rule.ruleType, result, start);
      return result;
    }
  }

  // --------------------------------------------------------------------------
  // Score Service Integration
  // --------------------------------------------------------------------------

  /**
   * Execute eligibility check via Score Service (Tier 2)
   */
  private async checkViaScoreService(
    rule: EligibilityRule,
    address: Address
  ): Promise<EligibilityResult> {
    switch (rule.ruleType) {
      case 'score_threshold': {
        const rankResponse = await this.scoreServiceClient.getAddressRank({
          communityId: rule.communityId,
          address,
          assetType: rule.parameters.assetType ?? 'token',
          contractAddress: rule.contractAddress,
          chainId: String(rule.chainId),
        });

        if (!rankResponse.found) {
          return {
            eligible: false,
            source: 'score_service',
            confidence: 1.0,
            details: { rank: undefined },
          };
        }

        const maxRank = rule.parameters.maxRank ?? 100;
        const eligible = rankResponse.rank <= maxRank;

        return {
          eligible,
          source: 'score_service',
          confidence: 1.0,
          details: {
            rank: rankResponse.rank,
            score: parseFloat(rankResponse.score),
          },
        };
      }

      case 'activity_check': {
        const actionResult = await this.scoreServiceClient.checkActionHistory({
          address,
          action: rule.parameters.actionType ?? 'swap',
        });

        return {
          eligible: actionResult.hasPerformed,
          source: 'score_service',
          confidence: 1.0,
          details: {},
        };
      }

      default:
        throw new Error(`Score Service doesn't support rule type: ${rule.ruleType}`);
    }
  }

  // --------------------------------------------------------------------------
  // Degradation Logic (SDD §6.1.6)
  // --------------------------------------------------------------------------

  /**
   * Degraded fallback when Score Service is unavailable
   *
   * Per SDD §6.1.6 Degradation Matrix:
   * - Rank threshold: Falls back to balance check (permissive, confidence 0.5)
   * - Activity check: Falls back to cached result or deny (safe, confidence 0.0-0.8)
   */
  private async degradedFallback(
    rule: EligibilityRule,
    address: Address
  ): Promise<EligibilityResult> {
    switch (rule.ruleType) {
      case 'score_threshold': {
        // Permissive fallback: Check if user has any balance
        // This errs on the side of granting access when Score Service is down
        const hasAnyBalance = await this.nativeReader.hasBalance(
          rule.chainId,
          address,
          rule.contractAddress,
          1n // Any balance
        );

        return {
          eligible: hasAnyBalance,
          source: 'native_degraded',
          confidence: 0.5, // Low confidence due to degradation
          details: {
            threshold: '1',
          },
        };
      }

      case 'activity_check': {
        // Safe fallback: Check cache, deny if not cached
        const cacheKey = `activity:${address}:${rule.parameters.actionType}`;
        const cached = await this.cache.get<boolean>(cacheKey);

        return {
          eligible: cached ?? false, // Deny if no cache
          source: 'native_degraded',
          confidence: cached ? 0.8 : 0.0, // Higher confidence if cached
          details: {},
        };
      }

      default:
        throw new Error(`No fallback available for rule type: ${rule.ruleType}`);
    }
  }

  // --------------------------------------------------------------------------
  // IChainProvider Implementation - Tier 1 Methods (delegate to Native Reader)
  // --------------------------------------------------------------------------

  async hasBalance(
    chainId: ChainId,
    address: Address,
    token: Address,
    minAmount: bigint
  ): Promise<boolean> {
    return this.nativeReader.hasBalance(chainId, address, token, minAmount);
  }

  async ownsNFT(
    chainId: ChainId,
    address: Address,
    collection: Address,
    tokenId?: bigint
  ): Promise<boolean> {
    return this.nativeReader.ownsNFT(chainId, address, collection, tokenId);
  }

  async getBalance(
    chainId: ChainId,
    address: Address,
    token: Address
  ): Promise<bigint> {
    return this.nativeReader.getBalance(chainId, address, token);
  }

  async getNativeBalance(chainId: ChainId, address: Address): Promise<bigint> {
    return this.nativeReader.getNativeBalance(chainId, address);
  }

  // --------------------------------------------------------------------------
  // IChainProvider Implementation - Tier 2 Methods (delegate to Score Service)
  // --------------------------------------------------------------------------

  async getRankedHolders(
    asset: AssetConfig,
    limit: number,
    offset?: number
  ): Promise<RankedHolder[]> {
    const response = await this.scoreServiceBreaker.fire(async () => {
      return this.scoreServiceClient.getRankedHolders({
        communityId: '', // Use default community context
        assetType: asset.type === 'native' ? 'token' : asset.type,
        contractAddress: asset.contractAddress ?? '',
        chainId: String(asset.chainId),
        limit,
        offset,
      });
    });

    const typedResponse = response as { holders: RankedHolder[] };
    return typedResponse.holders.map((h) => ({
      address: h.address as Address,
      rank: h.rank,
      score: h.score,
      balance: h.balance,
    }));
  }

  async getAddressRank(address: Address, asset: AssetConfig): Promise<number | null> {
    const response = await this.scoreServiceBreaker.fire(async () => {
      return this.scoreServiceClient.getAddressRank({
        communityId: '',
        address,
        assetType: asset.type === 'native' ? 'token' : asset.type,
        contractAddress: asset.contractAddress ?? '',
        chainId: String(asset.chainId),
      });
    });

    const typedResponse = response as { found: boolean; rank: number };
    return typedResponse.found ? typedResponse.rank : null;
  }

  async checkActionHistory(
    address: Address,
    config: ActionHistoryConfig
  ): Promise<boolean> {
    const response = await this.scoreServiceBreaker.fire(async () => {
      return this.scoreServiceClient.checkActionHistory({
        address,
        action: config.action,
        protocol: config.protocol,
        minCount: config.minCount,
        timeWindowSeconds: config.timeWindowSeconds,
      });
    });

    const typedResponse = response as { hasPerformed: boolean };
    return typedResponse.hasPerformed;
  }

  async getCrossChainScore(
    address: Address,
    chains: ChainId[]
  ): Promise<CrossChainScore> {
    const response = await this.scoreServiceBreaker.fire(async () => {
      return this.scoreServiceClient.getCrossChainScore({
        address,
        chainIds: chains.map(String),
      });
    });

    const typedResponse = response as {
      address: string;
      totalScore: string;
      chainScores: Array<{ chainId: string; score: string }>;
      computedAt: number;
    };

    return {
      address: typedResponse.address as Address,
      totalScore: typedResponse.totalScore,
      chainScores: Object.fromEntries(
        typedResponse.chainScores.map((cs) => [cs.chainId, cs.score])
      ),
      computedAt: new Date(typedResponse.computedAt),
    };
  }

  // --------------------------------------------------------------------------
  // Service Status
  // --------------------------------------------------------------------------

  async isScoreServiceAvailable(): Promise<boolean> {
    if (this.scoreServiceBreaker.opened) {
      return false;
    }

    try {
      const health = await this.scoreServiceClient.healthCheck();
      return health.status === 'SERVING';
    } catch {
      return false;
    }
  }

  getSupportedChains(): ChainId[] {
    return this.nativeReader.getSupportedChains();
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get the current Score Service circuit breaker state
   */
  getScoreServiceCircuitState(): CircuitState {
    if (this.scoreServiceBreaker.opened) return 'open';
    if (this.scoreServiceBreaker.halfOpen) return 'halfOpen';
    return 'closed';
  }

  /**
   * Get the underlying Native Reader for direct access
   */
  getNativeReader(): NativeBlockchainReader {
    return this.nativeReader;
  }

  /**
   * Get the underlying Score Service client for direct access
   */
  getScoreServiceClient(): IScoreServiceClient {
    return this.scoreServiceClient;
  }

  /**
   * Record metrics for eligibility check
   */
  private recordMetrics(
    ruleType: string,
    result: EligibilityResult,
    startTime: number
  ): void {
    const latencyMs = Date.now() - startTime;
    this.metrics?.recordEligibilityCheck(
      ruleType,
      result.source,
      result.eligible,
      latencyMs
    );
    this.log.debug(
      { ruleType, source: result.source, eligible: result.eligible, latencyMs },
      'Eligibility check completed'
    );
  }
}

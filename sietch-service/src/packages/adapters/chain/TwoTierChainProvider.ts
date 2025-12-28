/**
 * TwoTierChainProvider - Orchestrating Native Reader and Score Service
 *
 * Sprint 35: Score Service Adapter & Two-Tier Orchestration
 *
 * Implements IChainProvider with graceful degradation:
 * - Tier 1 (Native): Always available, binary checks via RPC
 * - Tier 2 (Score): Complex queries with circuit breaker protection
 *
 * Degradation Matrix (PRD §3.1):
 * - Full: Both tiers healthy
 * - Partial: Only Tier 1 available
 * - Cached: Using stale Score data
 *
 * @module packages/adapters/chain/TwoTierChainProvider
 */

import type { Address } from 'viem';
import type {
  IChainProvider,
  INativeReader,
  IScoreService,
  BasicEligibilityCriteria,
  AdvancedEligibilityCriteria,
  EligibilityResult,
  ScoreData,
  ChainProviderStatus,
  DegradationMode,
  ChainProviderConfig,
} from '../../core/ports/IChainProvider.js';
import { NativeBlockchainReader } from './NativeBlockchainReader.js';
import { ScoreServiceAdapter } from './ScoreServiceAdapter.js';

/**
 * In-memory cache for Score data fallback
 */
interface CacheEntry {
  data: ScoreData;
  cachedAt: Date;
}

/**
 * Default cache TTL: 5 minutes
 */
const DEFAULT_CACHE_TTL_SECONDS = 300;

/**
 * TwoTierChainProvider
 *
 * Orchestrates Tier 1 (Native) and Tier 2 (Score) with graceful degradation.
 * Provides automatic fallback when Score Service is unavailable.
 */
export class TwoTierChainProvider implements IChainProvider {
  private readonly nativeReader: INativeReader;
  private readonly scoreService: IScoreService;
  private readonly scoreAdapter: ScoreServiceAdapter;
  private readonly cache: Map<Address, CacheEntry> = new Map();
  private readonly cacheTtlSeconds: number;
  private lastScoreSuccess: Date | null = null;

  constructor(
    nativeReader: INativeReader,
    scoreService: IScoreService,
    cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS
  ) {
    this.nativeReader = nativeReader;
    this.scoreService = scoreService;
    this.scoreAdapter = scoreService as ScoreServiceAdapter;
    this.cacheTtlSeconds = cacheTtlSeconds;
  }

  /**
   * Check basic eligibility using Tier 1 (Native Reader)
   *
   * This method ALWAYS works as long as RPC is available.
   * No external dependencies required.
   */
  async checkBasicEligibility(
    address: Address,
    criteria: BasicEligibilityCriteria
  ): Promise<EligibilityResult> {
    const timestamp = new Date();

    try {
      // Check balance requirement
      if (criteria.minBalance) {
        const hasBalance = await this.nativeReader.hasBalance(
          address,
          criteria.minBalance.token,
          criteria.minBalance.amount
        );

        if (!hasBalance) {
          const balance = await this.nativeReader.getBalance(
            address,
            criteria.minBalance.token
          );

          return {
            eligible: false,
            source: 'native',
            timestamp,
            context: { balance },
          };
        }
      }

      // Check NFT ownership requirement
      if (criteria.nftOwnership) {
        const ownsNft = await this.nativeReader.ownsNFT(
          address,
          criteria.nftOwnership.collection,
          criteria.nftOwnership.chainId,
          criteria.nftOwnership.tokenIds
        );

        if (!ownsNft) {
          return {
            eligible: false,
            source: 'native',
            timestamp,
            context: { ownsNft: false },
          };
        }
      }

      // All checks passed
      return {
        eligible: true,
        source: 'native',
        timestamp,
        context: {
          balance: criteria.minBalance
            ? await this.nativeReader.getBalance(address, criteria.minBalance.token)
            : undefined,
          ownsNft: criteria.nftOwnership ? true : undefined,
        },
      };
    } catch (error) {
      // Fail-safe: return ineligible on error
      return {
        eligible: false,
        source: 'degraded',
        timestamp,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check advanced eligibility using Tier 2 (Score Service)
   *
   * This method may fail if Score Service is unavailable.
   * Falls back to cached data or returns degraded result.
   */
  async checkAdvancedEligibility(
    address: Address,
    criteria: AdvancedEligibilityCriteria
  ): Promise<EligibilityResult> {
    const timestamp = new Date();

    // Try to get score data from Score Service
    let scoreData = await this.getScoreDataWithFallback(address);

    if (!scoreData) {
      // Complete degradation - no data available
      return {
        eligible: false,
        source: 'degraded',
        timestamp,
        error: 'Score Service unavailable and no cached data',
      };
    }

    // Check rank requirements
    if (criteria.minRank !== undefined && scoreData.rank > criteria.minRank) {
      return {
        eligible: false,
        source: this.getScoreSource(address),
        timestamp,
        context: { rank: scoreData.rank },
      };
    }

    if (criteria.maxRank !== undefined && scoreData.rank < criteria.maxRank) {
      return {
        eligible: false,
        source: this.getScoreSource(address),
        timestamp,
        context: { rank: scoreData.rank },
      };
    }

    // Check conviction score
    if (
      criteria.minConvictionScore !== undefined &&
      scoreData.convictionScore < criteria.minConvictionScore
    ) {
      return {
        eligible: false,
        source: this.getScoreSource(address),
        timestamp,
        context: { convictionScore: scoreData.convictionScore },
      };
    }

    // Check activity score
    if (
      criteria.minActivityScore !== undefined &&
      scoreData.activityScore < criteria.minActivityScore
    ) {
      return {
        eligible: false,
        source: this.getScoreSource(address),
        timestamp,
        context: { convictionScore: scoreData.convictionScore },
      };
    }

    // Check time-weighted requirements
    if (criteria.timeWeighted) {
      const firstClaimMs = scoreData.firstClaimAt?.getTime() ?? Date.now();
      const holdingDays = (Date.now() - firstClaimMs) / (1000 * 60 * 60 * 24);

      if (holdingDays < criteria.timeWeighted.minHoldingDays) {
        return {
          eligible: false,
          source: this.getScoreSource(address),
          timestamp,
          context: { convictionScore: scoreData.convictionScore },
        };
      }

      if (scoreData.timeWeightedBalance < criteria.timeWeighted.minAverageBalance) {
        return {
          eligible: false,
          source: this.getScoreSource(address),
          timestamp,
          context: { convictionScore: scoreData.convictionScore },
        };
      }
    }

    // All checks passed
    return {
      eligible: true,
      source: this.getScoreSource(address),
      timestamp,
      context: {
        rank: scoreData.rank,
        convictionScore: scoreData.convictionScore,
      },
    };
  }

  /**
   * Get score data with circuit breaker and cache fallback
   */
  private async getScoreDataWithFallback(address: Address): Promise<ScoreData | null> {
    const normalizedAddress = address.toLowerCase() as Address;

    try {
      // Try Score Service first
      const scoreData = await this.scoreService.getScore(normalizedAddress);

      // Cache successful result
      this.cache.set(normalizedAddress, {
        data: scoreData,
        cachedAt: new Date(),
      });
      this.lastScoreSuccess = new Date();

      return scoreData;
    } catch {
      // Score Service failed, try cache
      return this.getCachedScore(normalizedAddress);
    }
  }

  /**
   * Get cached score if not expired
   */
  private getCachedScore(address: Address): ScoreData | null {
    const entry = this.cache.get(address);
    if (!entry) {
      return null;
    }

    const cacheAgeSeconds = (Date.now() - entry.cachedAt.getTime()) / 1000;
    if (cacheAgeSeconds > this.cacheTtlSeconds) {
      // Cache expired, but still return it in degraded mode
      // Better to have stale data than no data
      return entry.data;
    }

    return entry.data;
  }

  /**
   * Determine the source of score data
   */
  private getScoreSource(address: Address): 'score' | 'cached' | 'degraded' {
    const entry = this.cache.get(address.toLowerCase() as Address);
    if (!entry) {
      return 'degraded';
    }

    const cacheAgeSeconds = (Date.now() - entry.cachedAt.getTime()) / 1000;
    if (cacheAgeSeconds > this.cacheTtlSeconds) {
      return 'cached'; // Stale but usable
    }

    // Check if circuit breaker is open
    if (this.scoreAdapter.getCircuitBreakerState() === 'open') {
      return 'cached';
    }

    return 'score';
  }

  /**
   * Get score data for an address
   */
  async getScoreData(address: Address): Promise<ScoreData | null> {
    return this.getScoreDataWithFallback(address);
  }

  /**
   * Get current chain provider status
   */
  async getStatus(): Promise<ChainProviderStatus> {
    const nativeHealthy = await this.nativeReader.isHealthy();
    const scoreHealthy = await this.scoreService.isHealthy();
    const circuitBreakerState = this.scoreAdapter.getCircuitBreakerState();

    // Determine degradation mode
    let mode: DegradationMode;
    if (nativeHealthy && scoreHealthy && circuitBreakerState === 'closed') {
      mode = 'full';
    } else if (nativeHealthy && !scoreHealthy) {
      mode = 'partial';
    } else if (nativeHealthy && circuitBreakerState !== 'closed') {
      mode = 'cached';
    } else {
      mode = 'partial'; // Even if native is unhealthy, try to operate
    }

    // Calculate cache age
    let cacheAgeSeconds: number | null = null;
    if (this.cache.size > 0) {
      const oldestEntry = Array.from(this.cache.values()).reduce((oldest, entry) =>
        entry.cachedAt < oldest.cachedAt ? entry : oldest
      );
      cacheAgeSeconds = Math.floor(
        (Date.now() - oldestEntry.cachedAt.getTime()) / 1000
      );
    }

    return {
      mode,
      nativeHealthy,
      scoreHealthy,
      circuitBreakerState,
      lastScoreSuccess: this.lastScoreSuccess,
      cacheAgeSeconds,
    };
  }

  /**
   * Get the underlying native reader for direct access
   */
  getNativeReader(): INativeReader {
    return this.nativeReader;
  }

  /**
   * Get the underlying score service for direct access
   */
  getScoreService(): IScoreService | null {
    return this.scoreService;
  }

  /**
   * Clear the score cache (for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    oldestEntryAge: number | null;
    newestEntryAge: number | null;
  } {
    if (this.cache.size === 0) {
      return { size: 0, oldestEntryAge: null, newestEntryAge: null };
    }

    const entries = Array.from(this.cache.values());
    const now = Date.now();

    const ages = entries.map((e) => (now - e.cachedAt.getTime()) / 1000);

    return {
      size: this.cache.size,
      oldestEntryAge: Math.max(...ages),
      newestEntryAge: Math.min(...ages),
    };
  }
}

/**
 * Factory function to create TwoTierChainProvider from config
 */
export function createTwoTierChainProvider(
  config: ChainProviderConfig
): IChainProvider {
  const nativeReader = new NativeBlockchainReader(config.native);
  const scoreService = new ScoreServiceAdapter(config.score);

  return new TwoTierChainProvider(
    nativeReader,
    scoreService,
    config.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
  );
}

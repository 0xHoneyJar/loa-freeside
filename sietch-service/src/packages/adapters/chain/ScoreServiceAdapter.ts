/**
 * ScoreServiceAdapter - Tier 2 Score Service Client
 *
 * Sprint 35: Score Service Adapter & Two-Tier Orchestration
 *
 * Implements IScoreService for complex queries via Score Service API.
 * Features circuit breaker protection using opossum for resilience.
 *
 * @module packages/adapters/chain/ScoreServiceAdapter
 */

import CircuitBreaker from 'opossum';
import type { Address } from 'viem';
import type {
  IScoreService,
  ScoreData,
  LeaderboardEntry,
  ScoreServiceConfig,
} from '../../core/ports/IChainProvider.js';

/**
 * Default circuit breaker configuration
 * - Opens at 50% error rate
 * - Resets after 30 seconds
 * - 5 second timeout for requests
 */
const DEFAULT_BREAKER_OPTIONS = {
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  timeout: 5000,
  volumeThreshold: 5, // Minimum requests before opening
};

/**
 * Score API response types
 */
interface ScoreApiResponse {
  address: string;
  rank: number;
  convictionScore: number;
  activityScore: number;
  totalBgtHeld: string; // BigInt as string from API
  totalBgtClaimed: string;
  totalBgtBurned: string;
  timeWeightedBalance: string;
  firstClaimAt: string | null;
  lastActivityAt: string | null;
  updatedAt: string;
}

interface LeaderboardApiResponse {
  entries: Array<{
    rank: number;
    address: string;
    convictionScore: number;
    totalBgtHeld: string;
  }>;
  total: number;
}

interface HealthApiResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastUpdate: string | null;
}

/**
 * ScoreServiceAdapter
 *
 * Tier 2 implementation with HTTP client and circuit breaker.
 * Provides resilient access to Score Service API.
 */
export class ScoreServiceAdapter implements IScoreService {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly breaker: CircuitBreaker<[string], Response>;

  constructor(config: ScoreServiceConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? DEFAULT_BREAKER_OPTIONS.timeout;

    // Create circuit breaker for fetch operations
    this.breaker = new CircuitBreaker(
      async (url: string) => this.fetchWithTimeout(url),
      {
        ...DEFAULT_BREAKER_OPTIONS,
        errorThresholdPercentage:
          (config.errorThreshold ?? 0.5) * 100,
        resetTimeout: config.resetTimeout ?? DEFAULT_BREAKER_OPTIONS.resetTimeout,
        timeout: this.timeout,
      }
    );

    // Log circuit breaker events
    this.breaker.on('open', () => {
      console.warn('[ScoreServiceAdapter] Circuit breaker OPEN');
    });

    this.breaker.on('halfOpen', () => {
      console.info('[ScoreServiceAdapter] Circuit breaker HALF-OPEN');
    });

    this.breaker.on('close', () => {
      console.info('[ScoreServiceAdapter] Circuit breaker CLOSED');
    });
  }

  /**
   * Fetch with timeout using AbortController
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Score API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Execute request through circuit breaker
   */
  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const response = await this.breaker.fire(url);
    return response.json() as Promise<T>;
  }

  /**
   * Convert API response to ScoreData
   */
  private parseScoreData(data: ScoreApiResponse): ScoreData {
    return {
      address: data.address.toLowerCase() as Address,
      rank: data.rank,
      convictionScore: data.convictionScore,
      activityScore: data.activityScore,
      totalBgtHeld: BigInt(data.totalBgtHeld),
      totalBgtClaimed: BigInt(data.totalBgtClaimed),
      totalBgtBurned: BigInt(data.totalBgtBurned),
      timeWeightedBalance: BigInt(data.timeWeightedBalance),
      firstClaimAt: data.firstClaimAt ? new Date(data.firstClaimAt) : null,
      lastActivityAt: data.lastActivityAt ? new Date(data.lastActivityAt) : null,
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Get score data for a single address
   */
  async getScore(address: Address): Promise<ScoreData> {
    const data = await this.request<ScoreApiResponse>(
      `/scores/${address.toLowerCase()}`
    );
    return this.parseScoreData(data);
  }

  /**
   * Get scores for multiple addresses (batch)
   */
  async getScores(addresses: Address[]): Promise<Map<Address, ScoreData>> {
    // Use batch endpoint if available, otherwise parallel requests
    const addressList = addresses.map((a) => a.toLowerCase()).join(',');
    const data = await this.request<ScoreApiResponse[]>(
      `/scores/batch?addresses=${addressList}`
    );

    const result = new Map<Address, ScoreData>();
    for (const score of data) {
      const parsed = this.parseScoreData(score);
      result.set(parsed.address, parsed);
    }

    return result;
  }

  /**
   * Get leaderboard (top N addresses by conviction score)
   */
  async getLeaderboard(limit = 100, offset = 0): Promise<LeaderboardEntry[]> {
    const data = await this.request<LeaderboardApiResponse>(
      `/leaderboard?limit=${limit}&offset=${offset}`
    );

    return data.entries.map((entry) => ({
      rank: entry.rank,
      address: entry.address.toLowerCase() as Address,
      convictionScore: entry.convictionScore,
      totalBgtHeld: BigInt(entry.totalBgtHeld),
    }));
  }

  /**
   * Get rank for a specific address
   */
  async getRank(address: Address): Promise<number | null> {
    try {
      const data = await this.request<{ rank: number | null }>(
        `/scores/${address.toLowerCase()}/rank`
      );
      return data.rank;
    } catch {
      // Address not found or service unavailable
      return null;
    }
  }

  /**
   * Check if Score Service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const data = await this.request<HealthApiResponse>('/health');
      return data.status === 'healthy';
    } catch {
      return false;
    }
  }

  /**
   * Get last successful update timestamp
   */
  async getLastUpdate(): Promise<Date | null> {
    try {
      const data = await this.request<HealthApiResponse>('/health');
      return data.lastUpdate ? new Date(data.lastUpdate) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): 'closed' | 'open' | 'half-open' {
    if (this.breaker.opened) {
      return 'open';
    }
    if (this.breaker.halfOpen) {
      return 'half-open';
    }
    return 'closed';
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats(): {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    successes: number;
    rejects: number;
  } {
    const stats = this.breaker.stats;
    return {
      state: this.getCircuitBreakerState(),
      failures: stats.failures,
      successes: stats.successes,
      rejects: stats.rejects,
    };
  }
}

/**
 * Factory function to create ScoreServiceAdapter
 */
export function createScoreServiceAdapter(config: ScoreServiceConfig): IScoreService {
  return new ScoreServiceAdapter(config);
}

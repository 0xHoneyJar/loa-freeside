/**
 * Score Service Client
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * TypeScript client for communicating with the Score Service (Rust gRPC microservice).
 * Features:
 * - Circuit breaker protection (opossum)
 * - Configurable timeouts and retries
 * - Prometheus metrics integration
 * - Graceful degradation support
 *
 * @see SDD §6.1.4 Score Service (Rust Microservice)
 * @see SDD §6.1.5 Two-Tier Orchestrator
 */

import CircuitBreaker from 'opossum';
import type { Logger } from 'pino';
import {
  DEFAULT_SCORE_SERVICE_CONFIG,
  type IScoreServiceClient,
  type ScoreServiceClientConfig,
  type RankedHoldersRequest,
  type RankedHoldersResponse,
  type AddressRankRequest,
  type AddressRankResponse,
  type ActionHistoryRequest,
  type ActionHistoryResponse,
  type CrossChainScoreRequest,
  type CrossChainScoreResponse,
  type HealthCheckRequest,
  type HealthCheckResponse,
} from '../../core/ports/score-service.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Circuit breaker state */
type CircuitState = 'closed' | 'open' | 'halfOpen';

/** Metrics callback interface for Prometheus integration */
export interface ScoreServiceMetrics {
  /** Record request latency */
  recordLatency(method: string, latencyMs: number, success: boolean): void;
  /** Record circuit breaker state change */
  recordCircuitState(state: CircuitState): void;
  /** Increment request counter */
  incrementRequests(method: string, success: boolean): void;
}

/** Client statistics */
export interface ScoreServiceClientStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  circuitState: CircuitState;
  lastHealthCheck: Date | null;
  isHealthy: boolean;
}

// --------------------------------------------------------------------------
// Score Service Client Implementation
// --------------------------------------------------------------------------

/**
 * Score Service Client - Tier 2 Chain Provider Communication
 *
 * Communicates with the Score Service via HTTP/JSON (gRPC-Web compatible).
 * The actual Score Service is a Rust gRPC service, but we use HTTP/JSON
 * for simplicity in the TypeScript client.
 *
 * For production, this can be upgraded to use proper gRPC client (grpc-js).
 */
export class ScoreServiceClient implements IScoreServiceClient {
  private readonly log: Logger;
  private readonly config: Required<ScoreServiceClientConfig>;
  private readonly breaker: CircuitBreaker<unknown[], unknown>;
  private readonly metrics?: ScoreServiceMetrics;

  // Stats tracking
  private stats: ScoreServiceClientStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgLatencyMs: 0,
    circuitState: 'closed',
    lastHealthCheck: null,
    isHealthy: false,
  };
  private totalLatencyMs = 0;

  constructor(
    logger: Logger,
    config: ScoreServiceClientConfig,
    metrics?: ScoreServiceMetrics
  ) {
    this.log = logger.child({ component: 'ScoreServiceClient' });
    this.config = {
      ...DEFAULT_SCORE_SERVICE_CONFIG,
      ...config,
    } as Required<ScoreServiceClientConfig>;
    this.metrics = metrics;

    // Initialize circuit breaker
    this.breaker = new CircuitBreaker(
      async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      {
        timeout: this.config.timeoutMs,
        errorThresholdPercentage: this.config.errorThresholdPercentage,
        resetTimeout: this.config.resetTimeoutMs,
        volumeThreshold: this.config.volumeThreshold,
      }
    );

    // Circuit breaker event handlers
    this.breaker.on('open', () => {
      this.log.warn('Score Service circuit breaker OPEN');
      this.stats.circuitState = 'open';
      this.metrics?.recordCircuitState('open');
    });

    this.breaker.on('halfOpen', () => {
      this.log.info('Score Service circuit breaker HALF-OPEN');
      this.stats.circuitState = 'halfOpen';
      this.metrics?.recordCircuitState('halfOpen');
    });

    this.breaker.on('close', () => {
      this.log.info('Score Service circuit breaker CLOSED');
      this.stats.circuitState = 'closed';
      this.metrics?.recordCircuitState('closed');
    });

    this.breaker.on('fallback', () => {
      this.log.debug('Score Service circuit breaker fallback triggered');
    });

    this.log.info(
      {
        endpoint: this.config.endpoint,
        timeoutMs: this.config.timeoutMs,
        errorThreshold: this.config.errorThresholdPercentage,
      },
      'ScoreServiceClient initialized'
    );
  }

  // --------------------------------------------------------------------------
  // IScoreServiceClient Implementation
  // --------------------------------------------------------------------------

  async getRankedHolders(request: RankedHoldersRequest): Promise<RankedHoldersResponse> {
    return this.executeRequest('getRankedHolders', '/v1/ranked-holders', request);
  }

  async getAddressRank(request: AddressRankRequest): Promise<AddressRankResponse> {
    return this.executeRequest('getAddressRank', '/v1/address-rank', request);
  }

  async checkActionHistory(request: ActionHistoryRequest): Promise<ActionHistoryResponse> {
    return this.executeRequest('checkActionHistory', '/v1/action-history', request);
  }

  async getCrossChainScore(request: CrossChainScoreRequest): Promise<CrossChainScoreResponse> {
    return this.executeRequest('getCrossChainScore', '/v1/cross-chain-score', request);
  }

  async healthCheck(request?: HealthCheckRequest): Promise<HealthCheckResponse> {
    try {
      const response = await this.executeRequest<HealthCheckResponse>(
        'healthCheck',
        '/v1/health',
        request ?? {},
        true // Skip circuit breaker for health checks
      );
      this.stats.lastHealthCheck = new Date();
      this.stats.isHealthy = response.status === 'SERVING';
      return response;
    } catch (error) {
      this.stats.lastHealthCheck = new Date();
      this.stats.isHealthy = false;
      return {
        status: 'NOT_SERVING',
        message: (error as Error).message,
      };
    }
  }

  isConnected(): boolean {
    return this.stats.isHealthy && this.stats.circuitState !== 'open';
  }

  getCircuitState(): CircuitState {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'halfOpen';
    return 'closed';
  }

  async close(): Promise<void> {
    this.log.info('Closing ScoreServiceClient');
    // No persistent connections to close in HTTP client
    // For gRPC, this would close the channel
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Execute an HTTP request with circuit breaker and retry logic
   */
  private async executeRequest<T>(
    method: string,
    path: string,
    body: unknown,
    skipCircuitBreaker = false
  ): Promise<T> {
    const start = Date.now();
    this.stats.totalRequests++;

    const execute = async (): Promise<T> => {
      const url = `${this.config.endpoint}${path}`;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            // Exponential backoff
            const delay = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
            await this.sleep(delay);
            this.log.debug({ method, attempt, delay }, 'Retrying request');
          }

          const response = await this.fetchWithTimeout(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Score Service error: ${response.status} - ${errorText}`);
          }

          const result = (await response.json()) as T;

          // Success metrics
          const latency = Date.now() - start;
          this.stats.successfulRequests++;
          this.totalLatencyMs += latency;
          this.stats.avgLatencyMs = this.totalLatencyMs / this.stats.totalRequests;
          this.metrics?.recordLatency(method, latency, true);
          this.metrics?.incrementRequests(method, true);

          this.log.debug({ method, latencyMs: latency }, 'Score Service request successful');

          return result;
        } catch (error) {
          lastError = error as Error;
          this.log.warn(
            { method, attempt, error: lastError.message },
            'Score Service request failed'
          );
        }
      }

      // All retries exhausted
      const latency = Date.now() - start;
      this.stats.failedRequests++;
      this.metrics?.recordLatency(method, latency, false);
      this.metrics?.incrementRequests(method, false);

      throw lastError ?? new Error('Request failed after retries');
    };

    if (skipCircuitBreaker) {
      return execute();
    }

    // Execute with circuit breaker
    return this.breaker.fire(execute) as Promise<T>;
  }

  /**
   * Fetch with configurable timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --------------------------------------------------------------------------
  // Stats and Debugging
  // --------------------------------------------------------------------------

  /**
   * Get client statistics
   */
  getStats(): ScoreServiceClientStats {
    return { ...this.stats, circuitState: this.getCircuitState() };
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      circuitState: this.getCircuitState(),
      lastHealthCheck: null,
      isHealthy: false,
    };
    this.totalLatencyMs = 0;
  }
}

// --------------------------------------------------------------------------
// Mock Score Service Client (for testing)
// --------------------------------------------------------------------------

/**
 * Mock Score Service Client for testing and development
 *
 * Returns deterministic responses based on request parameters.
 * Useful for unit testing the TwoTierChainProvider without a real service.
 */
export class MockScoreServiceClient implements IScoreServiceClient {
  private connected = true;
  private circuitState: CircuitState = 'closed';
  private shouldFail = false;
  private latencyMs = 50;

  constructor(private readonly log: Logger) {
    this.log = log.child({ component: 'MockScoreServiceClient' });
  }

  async getRankedHolders(request: RankedHoldersRequest): Promise<RankedHoldersResponse> {
    await this.simulateLatency();
    this.checkFailure();

    const holders = Array.from({ length: Math.min(request.limit, 10) }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, '0')}`,
      rank: i + 1,
      score: (1000 - i * 100).toString(),
      balance: (BigInt(1000000 - i * 100000) * BigInt(10 ** 18)).toString(),
    }));

    return {
      holders,
      totalCount: 100,
      computedAt: Date.now(),
    };
  }

  async getAddressRank(request: AddressRankRequest): Promise<AddressRankResponse> {
    await this.simulateLatency();
    this.checkFailure();

    // Deterministic rank based on address
    const rank = parseInt(request.address.slice(-2), 16) % 100 + 1;
    const found = rank <= 50; // Top 50 addresses are "found"

    return {
      rank: found ? rank : 0,
      score: found ? (1000 - rank * 10).toString() : '0',
      totalHolders: 100,
      found,
    };
  }

  async checkActionHistory(request: ActionHistoryRequest): Promise<ActionHistoryResponse> {
    await this.simulateLatency();
    this.checkFailure();

    // Deterministic result based on address
    const hasPerformed = parseInt(request.address.slice(-1), 16) % 2 === 0;

    return {
      hasPerformed,
      count: hasPerformed ? 5 : 0,
      lastPerformedAt: hasPerformed ? Date.now() - 86400000 : undefined,
    };
  }

  async getCrossChainScore(request: CrossChainScoreRequest): Promise<CrossChainScoreResponse> {
    await this.simulateLatency();
    this.checkFailure();

    const chainScores = request.chainIds.map((chainId) => ({
      chainId,
      score: (parseInt(chainId) * 100).toString(),
    }));

    const totalScore = chainScores
      .reduce((sum, cs) => sum + BigInt(cs.score), BigInt(0))
      .toString();

    return {
      address: request.address,
      totalScore,
      chainScores,
      computedAt: Date.now(),
    };
  }

  async healthCheck(_request?: HealthCheckRequest): Promise<HealthCheckResponse> {
    await this.simulateLatency();

    return {
      status: this.connected && !this.shouldFail ? 'SERVING' : 'NOT_SERVING',
      message: this.connected ? 'OK' : 'Disconnected',
    };
  }

  isConnected(): boolean {
    return this.connected && this.circuitState !== 'open';
  }

  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  // --------------------------------------------------------------------------
  // Test Helpers
  // --------------------------------------------------------------------------

  /** Set whether the mock should fail */
  setFailure(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  /** Set connection state */
  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  /** Set circuit state */
  setCircuitState(state: CircuitState): void {
    this.circuitState = state;
  }

  /** Set simulated latency */
  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  private async simulateLatency(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }

  private checkFailure(): void {
    if (this.shouldFail) {
      throw new Error('Mock Score Service failure');
    }
  }
}

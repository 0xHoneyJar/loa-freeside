/**
 * RPC Pool with Circuit Breaker Pattern
 * Sprint S-2: RPC Pool & Circuit Breakers
 *
 * Implements resilient multi-provider RPC access with:
 * - Circuit breakers per provider (opossum)
 * - Automatic failover between providers
 * - Graceful degradation with cached results
 * - Prometheus metrics for monitoring
 */

import { createPublicClient, http, fallback, type PublicClient, type Chain } from 'viem';
import { berachain } from 'viem/chains';
import CircuitBreaker from 'opossum';
import type { Logger } from 'pino';
import type {
  RPCProvider,
  CircuitBreakerOptions,
  CircuitState,
  CacheEntry,
} from './types.js';
import {
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  DEFAULT_BERACHAIN_PROVIDERS,
} from './types.js';
import { RPCMetrics } from './metrics.js';
import { RPCCache } from './cache.js';

// ERC20 ABI for balance checks
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ERC721 ABI for ownership checks
const ERC721_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Multi-provider RPC Pool with circuit breakers
 */
export class RPCPool {
  private client: PublicClient;
  private breakers: Map<string, CircuitBreaker<unknown[], unknown>> = new Map();
  private providerClients: Map<string, PublicClient> = new Map();
  private readonly providers: RPCProvider[];
  private readonly log: Logger;
  private readonly metrics: RPCMetrics;
  private readonly cache: RPCCache;
  private readonly chain: Chain;

  constructor(
    providers: RPCProvider[] = DEFAULT_BERACHAIN_PROVIDERS,
    breakerOptions: CircuitBreakerOptions = DEFAULT_CIRCUIT_BREAKER_OPTIONS,
    logger: Logger,
    chain: Chain = berachain,
  ) {
    this.log = logger.child({ component: 'RPCPool' });
    this.providers = [...providers].sort((a, b) => a.priority - b.priority);
    this.chain = chain;
    this.metrics = new RPCMetrics();
    this.cache = new RPCCache(logger);

    this.log.info(
      { providers: this.providers.map((p) => p.name) },
      'Initializing RPC pool',
    );

    // Initialize circuit breakers and individual clients per provider
    this.providers.forEach((provider) => {
      // Create individual client for this provider
      const providerClient = createPublicClient({
        chain: this.chain,
        transport: http(provider.url, {
          timeout: breakerOptions.timeout,
          retryCount: 1,
        }),
      });
      this.providerClients.set(provider.name, providerClient);

      // Create circuit breaker for this provider
      const breaker = new CircuitBreaker(
        async <T>(fn: () => Promise<T>): Promise<T> => fn(),
        {
          timeout: breakerOptions.timeout,
          errorThresholdPercentage: breakerOptions.errorThresholdPercentage,
          resetTimeout: breakerOptions.resetTimeout,
          volumeThreshold: breakerOptions.volumeThreshold,
          rollingCountTimeout: breakerOptions.rollingCountTimeout || 10000,
          rollingCountBuckets: breakerOptions.rollingCountBuckets || 10,
        },
      );

      // Circuit breaker event handlers
      breaker.on('open', () => {
        this.log.warn({ provider: provider.name }, 'Circuit breaker OPENED - provider failing');
        this.metrics.recordCircuitStateChange(provider.name, 'open');
      });

      breaker.on('halfOpen', () => {
        this.log.info({ provider: provider.name }, 'Circuit breaker HALF-OPEN - testing provider');
        this.metrics.recordCircuitStateChange(provider.name, 'halfOpen');
      });

      breaker.on('close', () => {
        this.log.info({ provider: provider.name }, 'Circuit breaker CLOSED - provider recovered');
        this.metrics.recordCircuitStateChange(provider.name, 'closed');
      });

      breaker.on('success', () => {
        this.metrics.recordRequest(provider.name, true);
      });

      breaker.on('failure', () => {
        this.metrics.recordRequest(provider.name, false);
      });

      breaker.on('timeout', () => {
        this.log.warn({ provider: provider.name }, 'Request timed out');
        this.metrics.recordTimeout(provider.name);
      });

      breaker.on('reject', () => {
        this.log.debug({ provider: provider.name }, 'Request rejected - circuit open');
        this.metrics.recordRejection(provider.name);
      });

      this.breakers.set(provider.name, breaker);
    });

    // Create primary viem client with fallback transport
    this.client = createPublicClient({
      chain: this.chain,
      transport: fallback(
        this.providers.map((p) =>
          http(p.url, {
            timeout: breakerOptions.timeout,
            retryCount: 2,
          }),
        ),
        { rank: true },
      ),
    });

    this.log.info('RPC pool initialized');
  }

  /**
   * Get the primary viem client with automatic failover
   */
  getClient(): PublicClient {
    return this.client;
  }

  /**
   * Get ERC20 token balance for an address
   * Uses circuit breakers with graceful degradation
   */
  async getBalance(
    address: `0x${string}`,
    token: `0x${string}`,
  ): Promise<bigint> {
    const cacheKey = `balance:${token}:${address}`;

    // Try to execute with circuit breaker failover
    const result = await this.executeWithFailover(
      cacheKey,
      async (client) => {
        return client.readContract({
          address: token,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
      },
      60000, // 1 minute cache TTL
    );

    return result;
  }

  /**
   * Get ERC721 NFT balance for an address
   */
  async getNFTBalance(
    address: `0x${string}`,
    contract: `0x${string}`,
  ): Promise<bigint> {
    const cacheKey = `nft:${contract}:${address}`;

    return this.executeWithFailover(
      cacheKey,
      async (client) => {
        return client.readContract({
          address: contract,
          abi: ERC721_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
      },
      60000, // 1 minute cache TTL
    );
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<bigint> {
    const cacheKey = 'blockNumber';

    return this.executeWithFailover(
      cacheKey,
      async (client) => client.getBlockNumber(),
      5000, // 5 second cache TTL (blocks change frequently)
    );
  }

  /**
   * Execute a function with circuit breaker failover across providers
   * Falls back to cache if all providers fail
   */
  private async executeWithFailover<T>(
    cacheKey: string,
    fn: (client: PublicClient) => Promise<T>,
    cacheTtlMs: number,
  ): Promise<T> {
    const startTime = Date.now();

    // Try each provider in priority order
    for (const provider of this.providers) {
      const breaker = this.breakers.get(provider.name);
      const client = this.providerClients.get(provider.name);

      if (!breaker || !client) {
        continue;
      }

      // Skip if circuit is open (will throw rejection)
      if (breaker.opened) {
        this.log.debug({ provider: provider.name }, 'Skipping provider - circuit open');
        continue;
      }

      try {
        const result = await breaker.fire(async () => fn(client)) as T;

        // Cache successful result
        this.cache.set(cacheKey, result, cacheTtlMs);

        // Record latency
        const latency = Date.now() - startTime;
        this.metrics.recordLatency(provider.name, latency);

        this.log.debug(
          { provider: provider.name, latencyMs: latency },
          'RPC request successful',
        );

        return result;
      } catch (error) {
        this.log.warn(
          { provider: provider.name, error: (error as Error).message },
          'Provider request failed, trying next',
        );
        // Continue to next provider
      }
    }

    // All providers failed - try cache
    this.log.warn({ cacheKey }, 'All providers failed, attempting cache fallback');

    const cached = this.cache.get<T>(cacheKey);
    if (cached !== undefined) {
      this.log.info({ cacheKey }, 'Serving from cache (graceful degradation)');
      this.metrics.recordCacheHit();
      return cached;
    }

    this.metrics.recordCacheMiss();
    throw new Error(`All RPC providers failed and no cached result available for: ${cacheKey}`);
  }

  /**
   * Get circuit breaker states for all providers
   */
  getCircuitStates(): Record<string, CircuitState> {
    const states: Record<string, CircuitState> = {};

    this.breakers.forEach((breaker, name) => {
      if (breaker.opened) {
        states[name] = 'open';
      } else if (breaker.halfOpen) {
        states[name] = 'halfOpen';
      } else {
        states[name] = 'closed';
      }
    });

    return states;
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): RPCMetrics {
    return this.metrics;
  }

  /**
   * Check if pool is healthy (at least one provider available)
   */
  isHealthy(): boolean {
    const states = this.getCircuitStates();
    return Object.values(states).some((state) => state !== 'open');
  }

  /**
   * Get available (non-open) provider count
   */
  getAvailableProviderCount(): number {
    const states = this.getCircuitStates();
    return Object.values(states).filter((state) => state !== 'open').length;
  }

  /**
   * Manually trip a circuit breaker (for testing)
   */
  tripCircuit(providerName: string): void {
    const breaker = this.breakers.get(providerName);
    if (breaker) {
      breaker.open();
      this.log.warn({ provider: providerName }, 'Circuit manually tripped');
    }
  }

  /**
   * Manually reset a circuit breaker (for testing)
   */
  resetCircuit(providerName: string): void {
    const breaker = this.breakers.get(providerName);
    if (breaker) {
      breaker.close();
      this.log.info({ provider: providerName }, 'Circuit manually reset');
    }
  }

  /**
   * Clear the cache (for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

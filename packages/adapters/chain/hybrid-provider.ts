/**
 * Hybrid Chain Provider
 * Sprint 15: Dune Sim Integration & Rollout
 *
 * Implements IChainProvider with DuneSimClient as primary and
 * NativeBlockchainReader as fallback. Provides graceful degradation
 * when Dune Sim API is unavailable or doesn't support a chain.
 *
 * @see PRD §6.10 Dune Sim API Integration
 * @see SDD Section 28 HybridChainProvider
 */

import type { Logger } from 'pino';
import type {
  IChainProvider,
  Address,
  ChainId,
  AssetConfig,
  RankedHolder,
  CrossChainScore,
  ActionHistoryConfig,
  ChainProviderOptions,
} from '@arrakis/core/ports';
import type {
  TokenHoldersQueryOptions,
  TokenHoldersResult,
  DuneSimConfig,
} from './dune-sim-types.js';
import { DuneSimClient } from './dune-sim-client.js';
import { NativeBlockchainReader } from './native-reader.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Configuration for HybridChainProvider */
export interface HybridChainProviderConfig {
  /** Dune Sim configuration */
  duneSim: DuneSimConfig;
  /** RPC configuration (optional) */
  rpc?: ChainProviderOptions;
  /** Chain IDs that should always use RPC */
  rpcOnlyChains?: number[];
  /** Whether to fall back to RPC on Dune Sim errors */
  fallbackEnabled?: boolean;
}

/** Metrics for hybrid provider */
export interface HybridProviderMetrics {
  /** Total requests */
  requests: number;
  /** Requests to Dune Sim */
  duneSimRequests: number;
  /** Requests to RPC (direct or fallback) */
  rpcRequests: number;
  /** Fallback events */
  fallbacks: number;
  /** Fallback reasons */
  fallbackReasons: Record<string, number>;
}

// --------------------------------------------------------------------------
// HybridChainProvider Implementation
// --------------------------------------------------------------------------

/**
 * Hybrid Chain Provider
 *
 * Uses DuneSimClient as the primary data source with NativeBlockchainReader
 * as a fallback. Automatically falls back to RPC when:
 * - Dune Sim doesn't support the requested chain
 * - Dune Sim API returns an error
 * - The chain is configured as RPC-only
 */
export class HybridChainProvider implements IChainProvider {
  private readonly log: Logger;
  private readonly duneSimClient: DuneSimClient;
  private readonly rpcClient: NativeBlockchainReader;
  private readonly rpcOnlyChains: Set<number>;
  private readonly fallbackEnabled: boolean;

  // Metrics
  private metrics: HybridProviderMetrics = {
    requests: 0,
    duneSimRequests: 0,
    rpcRequests: 0,
    fallbacks: 0,
    fallbackReasons: {},
  };

  constructor(logger: Logger, config: HybridChainProviderConfig) {
    this.log = logger.child({ component: 'HybridChainProvider' });

    // Initialize Dune Sim client
    this.duneSimClient = new DuneSimClient(logger, config.duneSim);

    // Initialize RPC client
    this.rpcClient = new NativeBlockchainReader(logger, config.rpc);

    // Configure RPC-only chains
    this.rpcOnlyChains = new Set(config.rpcOnlyChains ?? []);

    // Configure fallback behavior
    this.fallbackEnabled = config.fallbackEnabled ?? true;

    this.log.info(
      {
        rpcOnlyChains: Array.from(this.rpcOnlyChains),
        fallbackEnabled: this.fallbackEnabled,
      },
      'HybridChainProvider initialized'
    );
  }

  // --------------------------------------------------------------------------
  // Routing Logic
  // --------------------------------------------------------------------------

  /**
   * Determine if a chain should use RPC directly
   */
  private shouldUseRpc(chainId: ChainId): boolean {
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
    return this.rpcOnlyChains.has(numericChainId);
  }

  /**
   * Execute with fallback to RPC on error
   */
  private async executeWithFallback<T>(
    chainId: ChainId,
    operation: string,
    duneSimFn: () => Promise<T>,
    rpcFn: () => Promise<T>
  ): Promise<T> {
    this.metrics.requests++;

    // Check if chain is RPC-only
    if (this.shouldUseRpc(chainId)) {
      this.log.debug({ chainId, operation }, 'Using RPC (chain is RPC-only)');
      this.metrics.rpcRequests++;
      return rpcFn();
    }

    // Try Dune Sim first
    try {
      this.metrics.duneSimRequests++;
      const result = await duneSimFn();
      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // If fallback is disabled, rethrow
      if (!this.fallbackEnabled) {
        this.log.error(
          { chainId, operation, error: errorMessage },
          'Dune Sim failed, fallback disabled'
        );
        throw error;
      }

      // Log fallback and record metrics
      this.log.warn(
        { chainId, operation, error: errorMessage },
        'Dune Sim failed, falling back to RPC'
      );

      this.metrics.fallbacks++;
      this.metrics.fallbackReasons[errorMessage] =
        (this.metrics.fallbackReasons[errorMessage] ?? 0) + 1;

      // Fall back to RPC
      this.metrics.rpcRequests++;
      return rpcFn();
    }
  }

  // --------------------------------------------------------------------------
  // Tier 1: IChainProvider Implementation
  // --------------------------------------------------------------------------

  /**
   * Check if an address has at least minAmount of a token
   */
  async hasBalance(
    chainId: ChainId,
    address: Address,
    token: Address,
    minAmount: bigint
  ): Promise<boolean> {
    return this.executeWithFallback(
      chainId,
      'hasBalance',
      () => this.duneSimClient.hasBalance(chainId, address, token, minAmount),
      () => this.rpcClient.hasBalance(chainId, address, token, minAmount)
    );
  }

  /**
   * Check if an address owns an NFT from a collection
   */
  async ownsNFT(
    chainId: ChainId,
    address: Address,
    collection: Address,
    tokenId?: bigint
  ): Promise<boolean> {
    return this.executeWithFallback(
      chainId,
      'ownsNFT',
      () => this.duneSimClient.ownsNFT(chainId, address, collection, tokenId),
      () => this.rpcClient.ownsNFT(chainId, address, collection, tokenId)
    );
  }

  /**
   * Get the exact balance of a token for an address
   */
  async getBalance(
    chainId: ChainId,
    address: Address,
    token: Address
  ): Promise<bigint> {
    return this.executeWithFallback(
      chainId,
      'getBalance',
      () => this.duneSimClient.getBalance(chainId, address, token),
      () => this.rpcClient.getBalance(chainId, address, token)
    );
  }

  /**
   * Get native token balance
   */
  async getNativeBalance(chainId: ChainId, address: Address): Promise<bigint> {
    return this.executeWithFallback(
      chainId,
      'getNativeBalance',
      () => this.duneSimClient.getNativeBalance(chainId, address),
      () => this.rpcClient.getNativeBalance(chainId, address)
    );
  }

  // --------------------------------------------------------------------------
  // Tier 2: Score Service Methods (Delegate to RPC/Throw)
  // --------------------------------------------------------------------------

  /**
   * Get ranked holders - NOT AVAILABLE
   * @throws Error Always throws - requires Score Service
   */
  async getRankedHolders(
    asset: AssetConfig,
    limit: number,
    offset?: number
  ): Promise<RankedHolder[]> {
    // Try RPC first (it will also throw, but with consistent error)
    return this.rpcClient.getRankedHolders(asset, limit, offset);
  }

  /**
   * Get address rank - NOT AVAILABLE
   * @throws Error Always throws - requires Score Service
   */
  async getAddressRank(address: Address, asset: AssetConfig): Promise<number | null> {
    return this.rpcClient.getAddressRank(address, asset);
  }

  /**
   * Check action history - NOT AVAILABLE
   * @throws Error Always throws - requires Score Service
   */
  async checkActionHistory(address: Address, config: ActionHistoryConfig): Promise<boolean> {
    return this.rpcClient.checkActionHistory(address, config);
  }

  /**
   * Get cross-chain score - NOT AVAILABLE
   * @throws Error Always throws - requires Score Service
   */
  async getCrossChainScore(address: Address, chains: ChainId[]): Promise<CrossChainScore> {
    return this.rpcClient.getCrossChainScore(address, chains);
  }

  // --------------------------------------------------------------------------
  // Service Status
  // --------------------------------------------------------------------------

  /**
   * Score Service is not available from HybridProvider
   */
  async isScoreServiceAvailable(): Promise<boolean> {
    return false;
  }

  /**
   * Get supported chain IDs (union of Dune Sim and RPC)
   */
  getSupportedChains(): ChainId[] {
    const duneSimChains = new Set(this.duneSimClient.getSupportedChains());
    const rpcChains = new Set(this.rpcClient.getSupportedChains());

    // Union of both
    return [...new Set([...duneSimChains, ...rpcChains])];
  }

  // --------------------------------------------------------------------------
  // Dune Sim Exclusive Methods (No Fallback)
  // --------------------------------------------------------------------------

  /**
   * Get balance with USD pricing (Dune Sim only)
   *
   * @throws Error if Dune Sim fails (no RPC fallback for USD data)
   */
  async getBalanceWithUSD(
    chainId: ChainId,
    address: Address,
    token: Address | 'native'
  ) {
    this.metrics.requests++;
    this.metrics.duneSimRequests++;
    return this.duneSimClient.getBalanceWithUSD(chainId, address, token);
  }

  /**
   * Get collectibles with metadata (Dune Sim only)
   *
   * @throws Error if Dune Sim fails (no RPC fallback)
   */
  async getCollectibles(
    address: Address,
    options?: { chainIds?: number[]; filterSpam?: boolean; limit?: number; cursor?: string }
  ) {
    this.metrics.requests++;
    this.metrics.duneSimRequests++;
    return this.duneSimClient.getCollectibles(address, options);
  }

  /**
   * Get transaction activity (Dune Sim only)
   *
   * @throws Error if Dune Sim fails (no RPC fallback)
   */
  async getActivity(
    address: Address,
    options?: { chainIds?: number[]; limit?: number; cursor?: string }
  ) {
    this.metrics.requests++;
    this.metrics.duneSimRequests++;
    return this.duneSimClient.getActivity(address, options);
  }

  /**
   * Get top token holders (Dune Sim only)
   *
   * Returns holders sorted by balance descending with pre-computed ranks.
   * Key API for Sietch BGT eligibility - replaces complex Transfer event
   * scanning + multicall balance queries.
   *
   * @throws Error if Dune Sim fails (no RPC fallback - this is Dune Sim exclusive)
   */
  async getTopTokenHolders(
    tokenAddress: Address,
    options: TokenHoldersQueryOptions
  ): Promise<TokenHoldersResult> {
    this.metrics.requests++;
    this.metrics.duneSimRequests++;
    return this.duneSimClient.getTopTokenHolders(tokenAddress, options);
  }

  // --------------------------------------------------------------------------
  // Configuration Methods
  // --------------------------------------------------------------------------

  /**
   * Set a chain to always use RPC
   */
  setRpcOnlyChain(chainId: number): void {
    this.rpcOnlyChains.add(chainId);
    this.log.info({ chainId }, 'Added chain to RPC-only list');
  }

  /**
   * Remove a chain from RPC-only list
   */
  removeRpcOnlyChain(chainId: number): void {
    this.rpcOnlyChains.delete(chainId);
    this.log.info({ chainId }, 'Removed chain from RPC-only list');
  }

  /**
   * Get list of RPC-only chains
   */
  getRpcOnlyChains(): number[] {
    return Array.from(this.rpcOnlyChains);
  }

  // --------------------------------------------------------------------------
  // Metrics and Health
  // --------------------------------------------------------------------------

  /**
   * Get metrics for observability
   */
  getMetrics(): HybridProviderMetrics {
    return { ...this.metrics };
  }

  /**
   * Get combined metrics from both providers
   */
  getDetailedMetrics() {
    return {
      hybrid: this.getMetrics(),
      duneSim: this.duneSimClient.getMetrics(),
      rpc: this.rpcClient.getMetrics(),
    };
  }

  /**
   * Check if the provider is healthy
   */
  async isHealthy(): Promise<boolean> {
    // Provider is healthy if at least one of the underlying providers is healthy
    const [duneSimHealthy, rpcHealthy] = await Promise.all([
      this.duneSimClient.isHealthy().catch(() => false),
      Promise.resolve(this.rpcClient.isHealthy()),
    ]);

    return duneSimHealthy || rpcHealthy;
  }

  /**
   * Get health status details
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    duneSim: { healthy: boolean; error?: string };
    rpc: { healthy: boolean; circuitStates: Record<ChainId, string> };
  }> {
    let duneSimHealthy = false;
    let duneSimError: string | undefined;

    try {
      duneSimHealthy = await this.duneSimClient.isHealthy();
    } catch (error) {
      duneSimError = (error as Error).message;
    }

    const rpcHealthy = this.rpcClient.isHealthy();
    const circuitStates = this.rpcClient.getCircuitStates();

    return {
      healthy: duneSimHealthy || rpcHealthy,
      duneSim: {
        healthy: duneSimHealthy,
        error: duneSimError,
      },
      rpc: {
        healthy: rpcHealthy,
        circuitStates,
      },
    };
  }

  /**
   * Clear caches on both providers
   */
  clearCache(): void {
    this.duneSimClient.clearCache();
    this.rpcClient.clearCache();
    this.log.info('Caches cleared on both providers');
  }
}

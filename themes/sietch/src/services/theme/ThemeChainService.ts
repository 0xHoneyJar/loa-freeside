/**
 * Theme Chain Service
 *
 * Multi-chain viem client manager for theme builder contract interactions.
 * Sprint 3: Web3 Layer - Chain Service
 *
 * Features:
 * - Creates viem PublicClient per chain on demand
 * - Uses fallback transport with multiple RPCs
 * - RPC health tracking
 * - Connection pooling and reuse
 * - Configurable timeouts
 *
 * @see grimoires/loa/sdd.md §9 Caching Architecture
 */

import {
  createPublicClient,
  http,
  fallback,
  type PublicClient,
  type Chain,
  type HttpTransportConfig,
} from 'viem';
import {
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
} from 'viem/chains';
import { berachain } from 'viem/chains';
import { logger } from '../../utils/logger.js';
import {
  CHAIN_CONFIGS,
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  getChainConfig,
} from '../../config/chains.js';
import type { ChainConfig, SupportedChainId } from '../../types/theme-web3.types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default timeout for RPC requests (30 seconds)
 */
const DEFAULT_TIMEOUT = 30_000;

/**
 * Default retry count for individual RPC endpoints
 */
const DEFAULT_RETRY_COUNT = 2;

/**
 * Default retry delay between attempts (ms)
 */
const DEFAULT_RETRY_DELAY = 1_000;

/**
 * Fallback transport retry count
 */
const FALLBACK_RETRY_COUNT = 3;

/**
 * Number of consecutive failures before marking endpoint unhealthy
 */
const UNHEALTHY_THRESHOLD = 3;

/**
 * Time before attempting to recover an unhealthy endpoint (5 minutes)
 */
const RECOVERY_INTERVAL = 5 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * RPC endpoint health tracking
 */
export interface RpcEndpointHealth {
  url: string;
  chainId: number;
  failureCount: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  isHealthy: boolean;
}

/**
 * Chain client configuration
 */
export interface ChainClientConfig {
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

/**
 * Chain client entry in the pool
 */
interface ChainClientEntry {
  client: PublicClient;
  chainId: number;
  createdAt: Date;
  lastUsed: Date;
}

// =============================================================================
// Chain Definitions (viem chain objects)
// =============================================================================

/**
 * Map of chain IDs to viem chain definitions
 */
const VIEM_CHAINS: Record<SupportedChainId, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
  137: polygon,
  80094: berachain,
};

// =============================================================================
// ThemeChainService
// =============================================================================

/**
 * ThemeChainService - Multi-chain client manager
 *
 * Manages viem PublicClient instances for all supported chains.
 * Clients are created on demand and pooled for reuse.
 *
 * @example
 * ```ts
 * const service = new ThemeChainService();
 * const client = await service.getClient(1); // Ethereum mainnet
 * const balance = await client.readContract(...);
 * ```
 */
export class ThemeChainService {
  private clientPool: Map<number, ChainClientEntry> = new Map();
  private rpcHealth: Map<string, RpcEndpointHealth> = new Map();
  private config: Required<ChainClientConfig>;

  constructor(config: ChainClientConfig = {}) {
    this.config = {
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      retryCount: config.retryCount ?? DEFAULT_RETRY_COUNT,
      retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
    };

    // Initialize health tracking for all RPCs across all chains
    for (const chainId of SUPPORTED_CHAIN_IDS) {
      const chainConfig = CHAIN_CONFIGS[chainId];
      const urls = chainConfig.rpcUrls ?? [chainConfig.rpcUrl];

      for (const url of urls) {
        this.rpcHealth.set(this.getHealthKey(chainId, url), {
          url,
          chainId,
          failureCount: 0,
          lastFailure: null,
          lastSuccess: null,
          isHealthy: true,
        });
      }
    }

    logger.info(
      {
        chains: SUPPORTED_CHAIN_IDS.length,
        timeout: this.config.timeout,
      },
      'ThemeChainService initialized'
    );
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Get a PublicClient for a specific chain
   *
   * Creates the client on first request, then returns from pool.
   *
   * @param chainId - EVM chain ID
   * @returns PublicClient instance
   * @throws Error if chain is not supported
   */
  getClient(chainId: number): PublicClient {
    // Validate chain ID
    if (!isSupportedChainId(chainId)) {
      throw new Error(
        `Unsupported chain ID: ${chainId}. Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`
      );
    }

    // Check pool
    const existing = this.clientPool.get(chainId);
    if (existing) {
      existing.lastUsed = new Date();
      return existing.client;
    }

    // Create new client
    const client = this.createClient(chainId);

    this.clientPool.set(chainId, {
      client,
      chainId,
      createdAt: new Date(),
      lastUsed: new Date(),
    });

    logger.debug({ chainId }, 'Created new chain client');
    return client;
  }

  /**
   * Get all pooled clients
   */
  getPooledClients(): Array<{ chainId: number; createdAt: Date; lastUsed: Date }> {
    return Array.from(this.clientPool.values()).map(entry => ({
      chainId: entry.chainId,
      createdAt: entry.createdAt,
      lastUsed: entry.lastUsed,
    }));
  }

  /**
   * Get health status for all RPC endpoints
   */
  getRpcHealth(): RpcEndpointHealth[] {
    return Array.from(this.rpcHealth.values());
  }

  /**
   * Get health status for a specific chain
   */
  getChainRpcHealth(chainId: number): RpcEndpointHealth[] {
    return this.getRpcHealth().filter(h => h.chainId === chainId);
  }

  /**
   * Check if a chain has healthy RPC endpoints
   */
  isChainHealthy(chainId: number): boolean {
    const chainHealth = this.getChainRpcHealth(chainId);
    return chainHealth.some(h => h.isHealthy);
  }

  /**
   * Check overall service health
   */
  async isHealthy(): Promise<boolean> {
    // Try to get block number from at least one chain
    for (const chainId of SUPPORTED_CHAIN_IDS) {
      try {
        const client = this.getClient(chainId);
        await client.getBlockNumber();
        return true;
      } catch {
        // Continue to next chain
      }
    }
    return false;
  }

  /**
   * Get current block number for a chain
   */
  async getBlockNumber(chainId: number): Promise<bigint> {
    const client = this.getClient(chainId);
    try {
      const blockNumber = await client.getBlockNumber();
      this.markRpcSuccess(chainId);
      return blockNumber;
    } catch (error) {
      this.markRpcFailure(chainId, error);
      throw error;
    }
  }

  /**
   * Clear client pool for a specific chain
   *
   * Useful for forcing reconnection after RPC issues.
   */
  clearClient(chainId: number): void {
    this.clientPool.delete(chainId);
    logger.debug({ chainId }, 'Cleared chain client from pool');
  }

  /**
   * Clear all clients from the pool
   */
  clearAllClients(): void {
    this.clientPool.clear();
    logger.info('Cleared all chain clients from pool');
  }

  /**
   * Attempt to recover unhealthy endpoints
   *
   * Re-enables endpoints that have been unhealthy for longer
   * than the recovery interval.
   */
  attemptRecovery(): number {
    let recovered = 0;
    const now = Date.now();

    for (const health of this.rpcHealth.values()) {
      if (
        !health.isHealthy &&
        health.lastFailure &&
        now - health.lastFailure.getTime() > RECOVERY_INTERVAL
      ) {
        health.isHealthy = true;
        health.failureCount = 0;
        recovered++;

        logger.info(
          { url: health.url, chainId: health.chainId },
          'RPC endpoint recovered'
        );
      }
    }

    if (recovered > 0) {
      // Clear affected clients to force recreation with recovered endpoints
      for (const health of this.rpcHealth.values()) {
        if (health.isHealthy) {
          this.clearClient(health.chainId);
        }
      }
    }

    return recovered;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Create a new PublicClient for a chain
   */
  private createClient(chainId: SupportedChainId): PublicClient {
    const chainConfig = getChainConfig(chainId);
    const viemChain = VIEM_CHAINS[chainId];

    // Get RPC URLs (primary + fallbacks)
    const rpcUrls = this.getHealthyRpcUrls(chainId, chainConfig);

    if (rpcUrls.length === 0) {
      throw new Error(
        `No healthy RPC endpoints available for chain ${chainId} (${chainConfig.name})`
      );
    }

    // Create transport configuration
    const transportConfig: HttpTransportConfig = {
      timeout: this.config.timeout,
      retryCount: this.config.retryCount,
      retryDelay: this.config.retryDelay,
    };

    // Create transports for each URL
    const transports = rpcUrls.map(url => http(url, transportConfig));

    // Create fallback transport or single transport
    // Use fallback even for single URL for consistent behavior
    const transport = fallback(transports, {
      rank: true, // Rank by latency
      retryCount: FALLBACK_RETRY_COUNT,
      retryDelay: this.config.retryDelay,
    });

    // Create client
    return createPublicClient({
      chain: viemChain,
      transport,
    });
  }

  /**
   * Get healthy RPC URLs for a chain, falling back to all if none healthy
   */
  private getHealthyRpcUrls(chainId: number, chainConfig: ChainConfig): string[] {
    const allUrls = chainConfig.rpcUrls ?? [chainConfig.rpcUrl];

    // Filter to healthy endpoints
    const healthyUrls = allUrls.filter(url => {
      const health = this.rpcHealth.get(this.getHealthKey(chainId, url));
      return health?.isHealthy ?? true;
    });

    // If all endpoints are unhealthy, use all as fallback
    if (healthyUrls.length === 0) {
      logger.warn(
        { chainId, urls: allUrls },
        'All RPC endpoints unhealthy, using all as fallback'
      );
      return allUrls;
    }

    return healthyUrls;
  }

  /**
   * Generate a unique key for RPC health tracking
   */
  private getHealthKey(chainId: number, url: string): string {
    return `${chainId}:${url}`;
  }

  /**
   * Mark RPC success for a chain
   */
  private markRpcSuccess(chainId: number): void {
    const chainConfig = CHAIN_CONFIGS[chainId as SupportedChainId];
    if (!chainConfig) return;

    const urls = chainConfig.rpcUrls ?? [chainConfig.rpcUrl];
    for (const url of urls) {
      const key = this.getHealthKey(chainId, url);
      const health = this.rpcHealth.get(key);
      if (health) {
        health.lastSuccess = new Date();
        if (!health.isHealthy) {
          health.isHealthy = true;
          health.failureCount = 0;
          logger.info({ chainId, url }, 'RPC endpoint recovered');
        }
      }
    }
  }

  /**
   * Mark RPC failure for a chain
   */
  private markRpcFailure(chainId: number, error: unknown): void {
    const chainConfig = CHAIN_CONFIGS[chainId as SupportedChainId];
    if (!chainConfig) return;

    // For simplicity, mark the primary URL as failed
    // In production, you'd want to track which URL specifically failed
    const url = chainConfig.rpcUrl;
    const key = this.getHealthKey(chainId, url);
    const health = this.rpcHealth.get(key);

    if (health) {
      health.failureCount++;
      health.lastFailure = new Date();

      if (health.failureCount >= UNHEALTHY_THRESHOLD && health.isHealthy) {
        health.isHealthy = false;
        logger.warn(
          { chainId, url, failureCount: health.failureCount, error },
          'RPC endpoint marked unhealthy'
        );
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Default ThemeChainService instance
 */
export const themeChainService = new ThemeChainService();

// =============================================================================
// Re-exports
// =============================================================================

export {
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  getChainConfig,
  getChainConfigSafe,
  getChainName,
  getAllChainConfigs,
  validateChainId,
} from '../../config/chains.js';

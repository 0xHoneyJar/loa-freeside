/**
 * Native Blockchain Reader
 * Sprint S-15: Native Blockchain Reader & Interface
 *
 * Tier 1 implementation of IChainProvider that performs direct RPC calls
 * for binary eligibility checks. Always available as the fallback when
 * Score Service (Tier 2) is unavailable.
 *
 * Features:
 * - Multi-chain support (Berachain, Ethereum, Polygon, Arbitrum, Base)
 * - Balance caching with 5-minute TTL
 * - Circuit breaker protection per chain
 * - ERC20 and ERC721 support
 *
 * @see SDD §6.1.3 Native Blockchain Reader
 */

import {
  createPublicClient,
  http,
  fallback,
  type PublicClient,
  type Chain,
  getAddress,
} from 'viem';
import { mainnet, polygon, arbitrum, base } from 'viem/chains';
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
  ChainConfig,
  ChainProviderOptions,
} from '@arrakis/core/ports';

// --------------------------------------------------------------------------
// ABIs
// --------------------------------------------------------------------------

/** ERC20 balanceOf ABI */
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

/** ERC721 ABI for ownership checks */
const ERC721_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Cache entry with expiration */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Circuit breaker state */
type CircuitState = 'closed' | 'open' | 'halfOpen';

/** Metrics for the native reader */
export interface NativeReaderMetrics {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  avgLatencyMs: number;
}

// --------------------------------------------------------------------------
// Berachain Chain Definition (not in viem/chains yet)
// --------------------------------------------------------------------------

const berachain: Chain = {
  id: 80094,
  name: 'Berachain',
  nativeCurrency: {
    name: 'BERA',
    symbol: 'BERA',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://berachain.drpc.org'],
    },
    public: {
      http: ['https://berachain-rpc.publicnode.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Beratrail',
      url: 'https://beratrail.io',
    },
  },
};

// --------------------------------------------------------------------------
// Chain ID to viem Chain mapping
// --------------------------------------------------------------------------

const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  42161: arbitrum,
  8453: base,
  80094: berachain,
};

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Default configuration */
const DEFAULT_CONFIG: Required<Omit<ChainProviderOptions, 'chains' | 'scoreServiceUrl'>> & {
  scoreServiceUrl: string | undefined;
} = {
  cacheTtlMs: 300_000, // 5 minutes
  timeoutMs: 10_000, // 10 seconds
  enableScoreService: false,
  scoreServiceUrl: undefined,
};

/** Circuit breaker options */
const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 10_000, // 10s timeout
  errorThresholdPercentage: 50, // Trip at 50% error rate
  resetTimeout: 30_000, // 30s before retry
  volumeThreshold: 5, // Minimum requests before tripping
};

// --------------------------------------------------------------------------
// Native Blockchain Reader Implementation
// --------------------------------------------------------------------------

/**
 * Native Blockchain Reader - Tier 1 Chain Provider
 *
 * Provides direct RPC access for binary eligibility checks with:
 * - Multi-chain support
 * - In-memory caching with configurable TTL
 * - Circuit breaker protection per chain
 * - Graceful degradation
 */
export class NativeBlockchainReader implements IChainProvider {
  private readonly log: Logger;
  private readonly config: typeof DEFAULT_CONFIG;
  private readonly clients: Map<ChainId, PublicClient> = new Map();
  private readonly breakers: Map<ChainId, CircuitBreaker<unknown[], unknown>> = new Map();
  private readonly cache: Map<string, CacheEntry<unknown>> = new Map();
  private readonly supportedChainIds: ChainId[] = [];

  // Metrics
  private metrics: NativeReaderMetrics = {
    requests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    avgLatencyMs: 0,
  };
  private totalLatencyMs = 0;

  constructor(logger: Logger, options: ChainProviderOptions = {}) {
    this.log = logger.child({ component: 'NativeBlockchainReader' });
    this.config = { ...DEFAULT_CONFIG, ...options };

    // Initialize default chains if none provided
    const chainConfigs = options.chains?.length
      ? options.chains
      : this.getDefaultChainConfigs();

    // Initialize clients and circuit breakers for each chain
    for (const chainConfig of chainConfigs) {
      this.initializeChain(chainConfig);
    }

    this.log.info(
      { supportedChains: this.supportedChainIds, cacheTtlMs: this.config.cacheTtlMs },
      'NativeBlockchainReader initialized'
    );

    // Start cache cleanup interval
    this.startCacheCleanup();
  }

  /**
   * Get default chain configurations
   */
  private getDefaultChainConfigs(): ChainConfig[] {
    // Import CHAIN_CONFIGS dynamically to avoid circular dependency
    return [
      {
        chainId: 80094,
        name: 'Berachain',
        symbol: 'BERA',
        rpcUrls: ['https://berachain.drpc.org', 'https://berachain-rpc.publicnode.com'],
        decimals: 18,
        isTestnet: false,
      },
      {
        chainId: 1,
        name: 'Ethereum',
        symbol: 'ETH',
        rpcUrls: ['https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'],
        decimals: 18,
        isTestnet: false,
      },
      {
        chainId: 137,
        name: 'Polygon',
        symbol: 'MATIC',
        rpcUrls: ['https://polygon.drpc.org', 'https://polygon-rpc.publicnode.com'],
        decimals: 18,
        isTestnet: false,
      },
      {
        chainId: 42161,
        name: 'Arbitrum One',
        symbol: 'ETH',
        rpcUrls: ['https://arbitrum.drpc.org', 'https://arbitrum-one-rpc.publicnode.com'],
        decimals: 18,
        isTestnet: false,
      },
      {
        chainId: 8453,
        name: 'Base',
        symbol: 'ETH',
        rpcUrls: ['https://base.drpc.org', 'https://base-rpc.publicnode.com'],
        decimals: 18,
        isTestnet: false,
      },
    ];
  }

  /**
   * Initialize a chain with client and circuit breaker
   */
  private initializeChain(chainConfig: ChainConfig): void {
    const chainId = typeof chainConfig.chainId === 'string'
      ? parseInt(chainConfig.chainId, 10)
      : chainConfig.chainId;

    // Get viem chain definition or create custom one
    const viemChain = VIEM_CHAINS[chainId] ?? this.createCustomChain(chainConfig);

    // Create viem client with fallback transports
    const client = createPublicClient({
      chain: viemChain,
      transport: fallback(
        chainConfig.rpcUrls.map((url) =>
          http(url, {
            timeout: this.config.timeoutMs,
            retryCount: 1,
          })
        ),
        { rank: true }
      ),
    });

    this.clients.set(chainId, client);
    this.supportedChainIds.push(chainId);

    // Create circuit breaker for this chain
    const breaker = new CircuitBreaker(
      async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      CIRCUIT_BREAKER_OPTIONS
    );

    breaker.on('open', () => {
      this.log.warn({ chainId }, 'Circuit breaker OPEN');
    });
    breaker.on('halfOpen', () => {
      this.log.info({ chainId }, 'Circuit breaker HALF-OPEN');
    });
    breaker.on('close', () => {
      this.log.info({ chainId }, 'Circuit breaker CLOSED');
    });

    this.breakers.set(chainId, breaker);

    this.log.debug(
      { chainId, name: chainConfig.name, rpcCount: chainConfig.rpcUrls.length },
      'Chain initialized'
    );
  }

  /**
   * Create a custom chain definition for viem
   */
  private createCustomChain(config: ChainConfig): Chain {
    const chainId = typeof config.chainId === 'string'
      ? parseInt(config.chainId, 10)
      : config.chainId;

    return {
      id: chainId,
      name: config.name,
      nativeCurrency: {
        name: config.name,
        symbol: config.symbol,
        decimals: config.decimals,
      },
      rpcUrls: {
        default: { http: config.rpcUrls },
        public: { http: config.rpcUrls },
      },
      blockExplorers: config.explorerUrl
        ? {
            default: {
              name: 'Explorer',
              url: config.explorerUrl,
            },
          }
        : undefined,
    };
  }

  /**
   * Start periodic cache cleanup
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt < now) {
          this.cache.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.log.debug({ cleaned, remaining: this.cache.size }, 'Cache cleanup');
      }
    }, 60_000); // Clean every minute
  }

  /**
   * Get client for a chain
   */
  private getClient(chainId: ChainId): PublicClient {
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
    const client = this.clients.get(numericChainId);
    if (!client) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    return client;
  }

  /**
   * Get circuit breaker for a chain
   */
  private getBreaker(chainId: ChainId): CircuitBreaker<unknown[], unknown> {
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
    const breaker = this.breakers.get(numericChainId);
    if (!breaker) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    return breaker;
  }

  /**
   * Execute a function with circuit breaker and caching
   */
  private async executeWithCache<T>(
    cacheKey: string,
    chainId: ChainId,
    fn: () => Promise<T>,
    ttlMs: number = this.config.cacheTtlMs
  ): Promise<T> {
    const start = Date.now();
    this.metrics.requests++;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.metrics.cacheHits++;
      this.log.debug({ cacheKey }, 'Cache hit');
      return cached.value as T;
    }

    this.metrics.cacheMisses++;

    // Execute with circuit breaker
    const breaker = this.getBreaker(chainId);

    try {
      const result = await breaker.fire(fn) as T;

      // Cache result
      this.cache.set(cacheKey, {
        value: result,
        expiresAt: Date.now() + ttlMs,
      });

      // Update metrics
      const latency = Date.now() - start;
      this.totalLatencyMs += latency;
      this.metrics.avgLatencyMs = this.totalLatencyMs / this.metrics.requests;

      this.log.debug({ cacheKey, latencyMs: latency }, 'RPC call successful');

      return result;
    } catch (error) {
      this.metrics.errors++;
      this.log.error({ cacheKey, error: (error as Error).message }, 'RPC call failed');
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Tier 1: Native Reader Methods (IChainProvider implementation)
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
    const balance = await this.getBalance(chainId, address, token);
    return balance >= minAmount;
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
    const cacheKey = tokenId !== undefined
      ? `nft:${chainId}:${collection}:${tokenId}:${address}`
      : `nft:${chainId}:${collection}:${address}`;

    const client = this.getClient(chainId);
    const normalizedAddress = getAddress(address);
    const normalizedCollection = getAddress(collection);

    return this.executeWithCache(cacheKey, chainId, async () => {
      if (tokenId !== undefined) {
        // Check specific tokenId ownership via ownerOf
        try {
          const owner = await client.readContract({
            address: normalizedCollection,
            abi: ERC721_ABI,
            functionName: 'ownerOf',
            args: [tokenId],
          });
          return owner.toLowerCase() === normalizedAddress.toLowerCase();
        } catch {
          // Token may not exist or be burned
          return false;
        }
      } else {
        // Check if address owns any token via balanceOf
        const balance = await client.readContract({
          address: normalizedCollection,
          abi: ERC721_ABI,
          functionName: 'balanceOf',
          args: [normalizedAddress],
        });
        return balance > 0n;
      }
    });
  }

  /**
   * Get the exact balance of a token for an address
   */
  async getBalance(
    chainId: ChainId,
    address: Address,
    token: Address
  ): Promise<bigint> {
    const cacheKey = `balance:${chainId}:${token}:${address}`;
    const client = this.getClient(chainId);
    const normalizedAddress = getAddress(address);
    const normalizedToken = getAddress(token);

    return this.executeWithCache(cacheKey, chainId, async () => {
      return client.readContract({
        address: normalizedToken,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [normalizedAddress],
      });
    });
  }

  /**
   * Get native token balance (ETH, BERA, MATIC, etc.)
   */
  async getNativeBalance(chainId: ChainId, address: Address): Promise<bigint> {
    const cacheKey = `native:${chainId}:${address}`;
    const client = this.getClient(chainId);
    const normalizedAddress = getAddress(address);

    return this.executeWithCache(cacheKey, chainId, async () => {
      return client.getBalance({ address: normalizedAddress });
    });
  }

  // --------------------------------------------------------------------------
  // Tier 2: Score Service Methods (Stubs - Not implemented in Native Reader)
  // --------------------------------------------------------------------------

  /**
   * Get ranked holders - NOT AVAILABLE in Native Reader
   * @throws Error Always throws - requires Score Service
   */
  async getRankedHolders(
    _asset: AssetConfig,
    _limit: number,
    _offset?: number
  ): Promise<RankedHolder[]> {
    throw new Error(
      'getRankedHolders requires Score Service (Tier 2). ' +
        'Native Reader only supports Tier 1 methods.'
    );
  }

  /**
   * Get address rank - NOT AVAILABLE in Native Reader
   * @throws Error Always throws - requires Score Service
   */
  async getAddressRank(
    _address: Address,
    _asset: AssetConfig
  ): Promise<number | null> {
    throw new Error(
      'getAddressRank requires Score Service (Tier 2). ' +
        'Native Reader only supports Tier 1 methods.'
    );
  }

  /**
   * Check action history - NOT AVAILABLE in Native Reader
   * @throws Error Always throws - requires Score Service
   */
  async checkActionHistory(
    _address: Address,
    _config: ActionHistoryConfig
  ): Promise<boolean> {
    throw new Error(
      'checkActionHistory requires Score Service (Tier 2). ' +
        'Native Reader only supports Tier 1 methods.'
    );
  }

  /**
   * Get cross-chain score - NOT AVAILABLE in Native Reader
   * @throws Error Always throws - requires Score Service
   */
  async getCrossChainScore(
    _address: Address,
    _chains: ChainId[]
  ): Promise<CrossChainScore> {
    throw new Error(
      'getCrossChainScore requires Score Service (Tier 2). ' +
        'Native Reader only supports Tier 1 methods.'
    );
  }

  // --------------------------------------------------------------------------
  // Service Status
  // --------------------------------------------------------------------------

  /**
   * Score Service is never available from Native Reader
   */
  async isScoreServiceAvailable(): Promise<boolean> {
    return false;
  }

  /**
   * Get supported chain IDs
   */
  getSupportedChains(): ChainId[] {
    return [...this.supportedChainIds];
  }

  // --------------------------------------------------------------------------
  // Additional Methods
  // --------------------------------------------------------------------------

  /**
   * Get circuit breaker states for all chains
   */
  getCircuitStates(): Record<ChainId, CircuitState> {
    const states: Record<ChainId, CircuitState> = {};

    for (const chainId of this.supportedChainIds) {
      const breaker = this.breakers.get(chainId as number);
      if (breaker) {
        if (breaker.opened) {
          states[chainId] = 'open';
        } else if (breaker.halfOpen) {
          states[chainId] = 'halfOpen';
        } else {
          states[chainId] = 'closed';
        }
      }
    }

    return states;
  }

  /**
   * Get reader metrics
   */
  getMetrics(): NativeReaderMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if at least one chain is healthy
   */
  isHealthy(): boolean {
    const states = this.getCircuitStates();
    return Object.values(states).some((state) => state !== 'open');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return {
      size: this.cache.size,
      hitRate: total > 0 ? this.metrics.cacheHits / total : 0,
    };
  }

  /**
   * Clear all cached entries
   */
  clearCache(): void {
    this.cache.clear();
    this.log.info('Cache cleared');
  }

  /**
   * Manually invalidate cache entries by pattern
   */
  invalidateByPattern(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.log.debug({ pattern, count }, 'Cache invalidated by pattern');
    return count;
  }
}

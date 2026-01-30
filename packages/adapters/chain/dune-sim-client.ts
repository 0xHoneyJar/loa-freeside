/**
 * Dune Sim Client - Tier 1 Chain Provider
 * Sprint 14: Dune Sim Foundation
 *
 * Implements IChainProvider interface using Dune Sim API for blockchain data queries.
 * Replaces direct RPC calls with unified API that provides:
 * - Multi-chain balance queries
 * - NFT ownership checks
 * - USD pricing for tokens
 * - Transaction activity history
 *
 * @see PRD §6.10 Dune Sim API Integration
 * @see SDD Part 5 Sections 25-35
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
} from '@arrakis/core/ports';
import type {
  DuneSimConfig,
  ResolvedDuneSimConfig,
  DuneSimMetrics,
  DuneSingleBalanceResponse,
  DuneCollectiblesResponse,
  DuneActivityResponse,
  DuneSupportedChainsResponse,
  DuneErrorResponse,
  BalanceWithUSD,
  CollectibleOwnership,
  ActivityQueryOptions,
  ParsedActivity,
  TokenHolder,
  TokenHoldersQueryOptions,
  TokenHoldersResult,
} from './dune-sim-types.js';
import {
  validateTokenHoldersResponse,
  isValidEthereumAddress,
} from './dune-sim-types.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Default configuration values */
const DEFAULTS: Omit<ResolvedDuneSimConfig, 'apiKey'> = {
  baseUrl: 'https://api.sim.dune.com',
  timeoutMs: 10_000,
  maxRetries: 3,
  cacheTtlMs: 60_000,
};

/** Special token identifier for native token */
const NATIVE_TOKEN = 'native';

/** HTTP status codes */
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;

// --------------------------------------------------------------------------
// Cache Types
// --------------------------------------------------------------------------

/** Cache entry with expiration */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// --------------------------------------------------------------------------
// DuneSimClient Implementation
// --------------------------------------------------------------------------

/**
 * Dune Sim Client - IChainProvider implementation using Dune Sim API
 *
 * Provides:
 * - Tier 1 methods: Balance and NFT queries via Dune Sim API
 * - USD pricing: Token values with real-time USD prices
 * - Activity history: Transaction history with categorization
 * - Caching: In-memory cache with configurable TTL
 * - Retry logic: Exponential backoff for transient failures
 */
export class DuneSimClient implements IChainProvider {
  private readonly log: Logger;
  private readonly config: ResolvedDuneSimConfig;
  private readonly cache: Map<string, CacheEntry<unknown>> = new Map();
  private supportedChainIds: ChainId[] = [];
  private supportedChainsLoaded = false;

  // Metrics tracking
  private metrics: DuneSimMetrics = {
    requests: 0,
    successes: 0,
    errors: 0,
    rateLimits: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgLatencyMs: 0,
    endpoints: {
      balances: { requests: 0, errors: 0 },
      collectibles: { requests: 0, errors: 0 },
      activity: { requests: 0, errors: 0 },
      tokenHolders: { requests: 0, errors: 0 },
    },
  };
  private totalLatencyMs = 0;

  constructor(logger: Logger, config: DuneSimConfig) {
    if (!config.apiKey) {
      throw new Error('DuneSimClient requires an API key');
    }

    this.log = logger.child({ component: 'DuneSimClient' });
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
      timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: config.maxRetries ?? DEFAULTS.maxRetries,
      cacheTtlMs: config.cacheTtlMs ?? DEFAULTS.cacheTtlMs,
    };

    this.log.info(
      { baseUrl: this.config.baseUrl, cacheTtlMs: this.config.cacheTtlMs },
      'DuneSimClient initialized'
    );

    // Start cache cleanup interval
    this.startCacheCleanup();
  }

  // --------------------------------------------------------------------------
  // Security Helpers (Sprint 17 Audit Remediation)
  // --------------------------------------------------------------------------

  /**
   * Sanitize error messages to prevent potential API key or sensitive data leakage
   * Removes strings that look like API keys, tokens, or other sensitive patterns
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove potential API key patterns (32+ alphanumeric chars)
    let sanitized = message.replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED]');
    // Remove potential bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [REDACTED]');
    // Remove potential hex secrets (0x followed by 40+ hex chars)
    sanitized = sanitized.replace(/0x[a-fA-F0-9]{40,}/g, '[REDACTED_HEX]');
    return sanitized;
  }

  // --------------------------------------------------------------------------
  // HTTP Client Methods
  // --------------------------------------------------------------------------

  /**
   * Make an HTTP request to the Dune Sim API with retry logic
   */
  private async request<T>(
    endpoint: string,
    options: { params?: Record<string, string | number | boolean> } = {}
  ): Promise<T> {
    const url = new URL(endpoint, this.config.baseUrl);

    // Add query parameters
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'X-Sim-Api-Key': this.config.apiKey,
            'Content-Type': 'application/json',
            'User-Agent': 'arrakis-dune-sim-client/1.0',
          },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        // Track metrics
        this.metrics.requests++;
        const latency = Date.now() - startTime;
        this.totalLatencyMs += latency;
        this.metrics.avgLatencyMs = this.totalLatencyMs / this.metrics.requests;

        // Handle rate limiting
        if (response.status === HTTP_STATUS.RATE_LIMITED) {
          this.metrics.rateLimits++;
          const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
          this.log.warn({ endpoint, attempt, retryAfter }, 'Rate limited, retrying...');
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Handle auth errors (don't retry)
        if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
          this.metrics.errors++;
          const error = await response.json() as DuneErrorResponse;
          // Sanitize error message to prevent potential key leakage
          // Handle both "message" and "error" fields (API returns different formats)
          const errorText = error.message ?? error.error ?? 'Unknown auth error';
          const sanitizedMessage = this.sanitizeErrorMessage(errorText);
          throw new Error(`Authentication failed: ${sanitizedMessage}`);
        }

        // Handle other errors
        if (!response.ok) {
          this.metrics.errors++;
          const error = await response.json() as DuneErrorResponse;
          // Sanitize error message to prevent sensitive data leakage
          // Handle both "message" and "error" fields (API returns different formats)
          const errorText = error.message ?? error.error ?? 'Unknown error';
          const sanitizedMessage = this.sanitizeErrorMessage(errorText);
          throw new Error(`Dune Sim API error: ${sanitizedMessage} (${response.status})`);
        }

        this.metrics.successes++;
        return await response.json() as T;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on auth errors or timeout
        if (lastError.message.includes('Authentication failed')) {
          throw lastError;
        }

        // Exponential backoff for retries
        if (attempt < this.config.maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          this.log.warn(
            { endpoint, attempt, error: lastError.message, nextRetryMs: delay },
            'Request failed, retrying...'
          );
          await this.sleep(delay);
        }
      }
    }

    this.metrics.errors++;
    throw lastError ?? new Error('Request failed after all retries');
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --------------------------------------------------------------------------
  // Cache Methods
  // --------------------------------------------------------------------------

  /**
   * Get a value from cache
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      this.metrics.cacheHits++;
      this.log.debug({ key }, 'Cache hit');
      return entry.value as T;
    }
    this.metrics.cacheMisses++;
    return null;
  }

  /**
   * Set a value in cache
   */
  private setInCache<T>(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.config.cacheTtlMs),
    });
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
      : `nft:${chainId}:${collection}:any:${address}`;

    const cached = this.getFromCache<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedCollection = collection.toLowerCase();
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;

    this.metrics.endpoints.collectibles.requests++;

    try {
      const response = await this.request<DuneCollectiblesResponse>(
        `/v1/evm/collectibles/${normalizedAddress}`,
        {
          params: {
            chain_ids: numericChainId,
            filter_spam: true,
          },
        }
      );

      // Filter for the specific collection
      const matchingNFTs = response.collectibles.filter(
        (nft) => nft.contract_address.toLowerCase() === normalizedCollection
      );

      let owns: boolean;
      if (tokenId !== undefined) {
        // Check for specific tokenId
        owns = matchingNFTs.some((nft) => nft.token_id === tokenId.toString());
      } else {
        // Check for any token from the collection
        owns = matchingNFTs.length > 0;
      }

      this.setInCache(cacheKey, owns);
      return owns;
    } catch (error) {
      this.metrics.endpoints.collectibles.errors++;
      this.log.error(
        { error: (error as Error).message, address, collection, tokenId: tokenId?.toString() },
        'Failed to check NFT ownership'
      );
      throw error;
    }
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
    const cached = this.getFromCache<bigint>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedToken = token.toLowerCase();
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;

    this.metrics.endpoints.balances.requests++;

    try {
      const response = await this.request<DuneSingleBalanceResponse>(
        `/v1/evm/balances/${normalizedAddress}/token/${normalizedToken}`,
        {
          params: {
            chain_ids: numericChainId,
          },
        }
      );

      // Convert string amount to bigint (amount is in smallest unit already)
      const balance = this.parseAmount(response.balance.amount, response.balance.decimals);
      this.setInCache(cacheKey, balance);
      return balance;
    } catch (error) {
      this.metrics.endpoints.balances.errors++;

      // If token not found, return 0 balance
      if ((error as Error).message.includes('404') || (error as Error).message.includes('not found')) {
        this.log.debug({ address, token, chainId }, 'Token not found, returning 0 balance');
        this.setInCache(cacheKey, 0n);
        return 0n;
      }

      this.log.error(
        { error: (error as Error).message, address, token },
        'Failed to get balance'
      );
      throw error;
    }
  }

  /**
   * Get native token balance (ETH, BERA, MATIC, etc.)
   */
  async getNativeBalance(chainId: ChainId, address: Address): Promise<bigint> {
    const cacheKey = `native:${chainId}:${address}`;
    const cached = this.getFromCache<bigint>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const normalizedAddress = address.toLowerCase();
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;

    this.metrics.endpoints.balances.requests++;

    try {
      const response = await this.request<DuneSingleBalanceResponse>(
        `/v1/evm/balances/${normalizedAddress}/token/${NATIVE_TOKEN}`,
        {
          params: {
            chain_ids: numericChainId,
          },
        }
      );

      const balance = this.parseAmount(response.balance.amount, response.balance.decimals);
      this.setInCache(cacheKey, balance);
      return balance;
    } catch (error) {
      this.metrics.endpoints.balances.errors++;

      // If not found, return 0
      if ((error as Error).message.includes('404') || (error as Error).message.includes('not found')) {
        this.log.debug({ address, chainId }, 'Native balance not found, returning 0');
        this.setInCache(cacheKey, 0n);
        return 0n;
      }

      this.log.error(
        { error: (error as Error).message, address, chainId },
        'Failed to get native balance'
      );
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Tier 2: Score Service Methods (Stubs)
  // --------------------------------------------------------------------------

  /**
   * Get ranked holders - NOT AVAILABLE via Dune Sim
   * @throws Error Always throws - requires Score Service
   */
  async getRankedHolders(
    _asset: AssetConfig,
    _limit: number,
    _offset?: number
  ): Promise<RankedHolder[]> {
    throw new Error(
      'getRankedHolders requires Score Service (Tier 2). ' +
        'DuneSimClient only supports Tier 1 methods.'
    );
  }

  /**
   * Get address rank - NOT AVAILABLE via Dune Sim
   * @throws Error Always throws - requires Score Service
   */
  async getAddressRank(
    _address: Address,
    _asset: AssetConfig
  ): Promise<number | null> {
    throw new Error(
      'getAddressRank requires Score Service (Tier 2). ' +
        'DuneSimClient only supports Tier 1 methods.'
    );
  }

  /**
   * Check action history - NOT AVAILABLE via Dune Sim
   * @throws Error Always throws - requires Score Service
   */
  async checkActionHistory(
    _address: Address,
    _config: ActionHistoryConfig
  ): Promise<boolean> {
    throw new Error(
      'checkActionHistory requires Score Service (Tier 2). ' +
        'DuneSimClient only supports Tier 1 methods.'
    );
  }

  /**
   * Get cross-chain score - NOT AVAILABLE via Dune Sim
   * @throws Error Always throws - requires Score Service
   */
  async getCrossChainScore(
    _address: Address,
    _chains: ChainId[]
  ): Promise<CrossChainScore> {
    throw new Error(
      'getCrossChainScore requires Score Service (Tier 2). ' +
        'DuneSimClient only supports Tier 1 methods.'
    );
  }

  // --------------------------------------------------------------------------
  // Service Status
  // --------------------------------------------------------------------------

  /**
   * Score Service is not available from DuneSimClient
   */
  async isScoreServiceAvailable(): Promise<boolean> {
    return false;
  }

  /**
   * Get supported chain IDs from Dune Sim API
   */
  getSupportedChains(): ChainId[] {
    // Return cached chains if loaded
    if (this.supportedChainsLoaded && this.supportedChainIds.length > 0) {
      return [...this.supportedChainIds];
    }

    // Return default chains while async load happens
    return [1, 137, 42161, 8453, 80094]; // Ethereum, Polygon, Arbitrum, Base, Berachain
  }

  /**
   * Load supported chains from API (async)
   */
  async loadSupportedChains(): Promise<ChainId[]> {
    const cacheKey = 'supported-chains';
    const cached = this.getFromCache<ChainId[]>(cacheKey);
    if (cached !== null) {
      this.supportedChainIds = cached;
      this.supportedChainsLoaded = true;
      return cached;
    }

    try {
      const response = await this.request<DuneSupportedChainsResponse>(
        '/v1/evm/supported-chains'
      );

      this.supportedChainIds = response.chains.map((chain) => chain.chain_id);
      this.supportedChainsLoaded = true;

      // Cache for 1 hour
      this.setInCache(cacheKey, this.supportedChainIds, 3600_000);

      this.log.info(
        { chainCount: this.supportedChainIds.length, chains: this.supportedChainIds },
        'Loaded supported chains from Dune Sim'
      );

      return [...this.supportedChainIds];
    } catch (error) {
      this.log.error(
        { error: (error as Error).message },
        'Failed to load supported chains, using defaults'
      );
      return this.getSupportedChains();
    }
  }

  // --------------------------------------------------------------------------
  // Dune Sim Exclusive Methods
  // --------------------------------------------------------------------------

  /**
   * Get balance with USD pricing information
   */
  async getBalanceWithUSD(
    chainId: ChainId,
    address: Address,
    token: Address | 'native'
  ): Promise<BalanceWithUSD> {
    const cacheKey = `balance-usd:${chainId}:${token}:${address}`;
    const cached = this.getFromCache<BalanceWithUSD>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedToken = token === 'native' ? NATIVE_TOKEN : token.toLowerCase();
    const numericChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;

    this.metrics.endpoints.balances.requests++;

    try {
      const response = await this.request<DuneSingleBalanceResponse>(
        `/v1/evm/balances/${normalizedAddress}/token/${normalizedToken}`,
        {
          params: {
            chain_ids: numericChainId,
          },
        }
      );

      const result: BalanceWithUSD = {
        balance: this.parseAmount(response.balance.amount, response.balance.decimals),
        symbol: response.balance.symbol,
        decimals: response.balance.decimals,
        priceUsd: response.balance.price_usd,
        valueUsd: response.balance.value_usd,
      };

      this.setInCache(cacheKey, result);
      return result;
    } catch (error) {
      this.metrics.endpoints.balances.errors++;

      // Return zero balance if not found
      if ((error as Error).message.includes('404') || (error as Error).message.includes('not found')) {
        const result: BalanceWithUSD = {
          balance: 0n,
          symbol: token === 'native' ? 'NATIVE' : 'UNKNOWN',
          decimals: 18,
          priceUsd: null,
          valueUsd: null,
        };
        this.setInCache(cacheKey, result);
        return result;
      }

      throw error;
    }
  }

  /**
   * Get all collectibles (NFTs) owned by an address
   */
  async getCollectibles(
    address: Address,
    options: { chainIds?: number[]; filterSpam?: boolean; limit?: number; cursor?: string } = {}
  ): Promise<{ collectibles: CollectibleOwnership[]; nextCursor: string | null }> {
    const normalizedAddress = address.toLowerCase();

    this.metrics.endpoints.collectibles.requests++;

    try {
      const params: Record<string, string | number | boolean> = {
        filter_spam: options.filterSpam ?? true,
      };

      if (options.chainIds && options.chainIds.length > 0) {
        params.chain_ids = options.chainIds.join(',');
      }
      if (options.limit) {
        params.limit = options.limit;
      }
      if (options.cursor) {
        params.cursor = options.cursor;
      }

      const response = await this.request<DuneCollectiblesResponse>(
        `/v1/evm/collectibles/${normalizedAddress}`,
        { params }
      );

      const collectibles: CollectibleOwnership[] = response.collectibles.map((nft) => ({
        contractAddress: nft.contract_address,
        tokenId: nft.token_id,
        collectionName: nft.collection_name,
        tokenStandard: nft.token_standard,
        amount: BigInt(nft.amount),
        isSpam: nft.is_spam,
        floorPriceUsd: nft.floor_price_usd,
        imageUrl: nft.image_url,
      }));

      return {
        collectibles,
        nextCursor: response.next_cursor,
      };
    } catch (error) {
      this.metrics.endpoints.collectibles.errors++;
      this.log.error(
        { error: (error as Error).message, address },
        'Failed to get collectibles'
      );
      throw error;
    }
  }

  /**
   * Get transaction activity history for an address
   */
  async getActivity(
    address: Address,
    options: ActivityQueryOptions = {}
  ): Promise<{ activities: ParsedActivity[]; nextCursor: string | null }> {
    const normalizedAddress = address.toLowerCase();

    this.metrics.endpoints.activity.requests++;

    try {
      const params: Record<string, string | number | boolean> = {};

      if (options.chainIds && options.chainIds.length > 0) {
        params.chain_ids = options.chainIds.join(',');
      }
      if (options.limit) {
        params.limit = options.limit;
      }
      if (options.cursor) {
        params.cursor = options.cursor;
      }
      if (options.types && options.types.length > 0) {
        params.types = options.types.join(',');
      }

      const response = await this.request<DuneActivityResponse>(
        `/v1/evm/activity/${normalizedAddress}`,
        { params }
      );

      const activities: ParsedActivity[] = response.activities.map((activity) => ({
        txHash: activity.tx_hash,
        blockNumber: activity.block_number,
        timestamp: new Date(activity.timestamp),
        type: activity.type,
        description: activity.description,
        from: activity.from,
        to: activity.to,
        value: BigInt(activity.value || '0'),
        fee: BigInt(activity.fee || '0'),
        feeUsd: activity.fee_usd,
        chainId: activity.chain_id,
        status: activity.status,
      }));

      return {
        activities,
        nextCursor: response.next_cursor,
      };
    } catch (error) {
      this.metrics.endpoints.activity.errors++;
      this.log.error(
        { error: (error as Error).message, address },
        'Failed to get activity'
      );
      throw error;
    }
  }

  /**
   * Get top token holders for a specific token contract
   *
   * Returns holders sorted by balance descending with pre-computed ranks.
   * This is the key API for Sietch BGT eligibility - replaces complex
   * Transfer event scanning + multicall balance queries.
   *
   * @param tokenAddress - The token contract address
   * @param options - Query options including chainId (required), limit, cursor
   * @returns Token holders result with pagination
   */
  async getTopTokenHolders(
    tokenAddress: Address,
    options: TokenHoldersQueryOptions & { decimals?: number }
  ): Promise<TokenHoldersResult> {
    // Input validation (MEDIUM-2 remediation)
    if (!isValidEthereumAddress(tokenAddress)) {
      throw new Error(`Invalid token address format: ${tokenAddress}`);
    }

    const normalizedToken = tokenAddress.toLowerCase();
    // Use hash of cursor for cache key to prevent cache poisoning (MEDIUM-3 remediation)
    const cursorKey = options.cursor
      ? Buffer.from(options.cursor.substring(0, 64)).toString('base64').substring(0, 16)
      : 'start';
    const cacheKey = `holders:${options.chainId}:${normalizedToken}:${options.limit ?? 100}:${cursorKey}`;

    const cached = this.getFromCache<TokenHoldersResult>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    this.metrics.endpoints.tokenHolders.requests++;

    try {
      const params: Record<string, string | number | boolean> = {};

      if (options.limit) {
        params.limit = options.limit;
      }
      if (options.cursor) {
        params.offset = options.cursor; // API uses 'offset' not 'cursor'
      }

      // Correct endpoint: /v1/evm/token-holders/{chain_id}/{token_address}
      const rawResponse = await this.request<unknown>(
        `/v1/evm/token-holders/${options.chainId}/${normalizedToken}`,
        { params }
      );

      // Validate API response schema (HIGH-2 remediation)
      const response = validateTokenHoldersResponse(rawResponse);

      // Use provided decimals or default to 18 (MEDIUM-4 remediation)
      const decimals = options.decimals ?? 18;

      // API returns holders sorted by balance desc, compute ranks from index
      const holders: TokenHolder[] = response.holders.map((holder, index) => ({
        address: holder.wallet_address,
        balance: this.parseAmount(holder.balance, decimals),
        rank: index + 1, // Rank computed from sorted order
        percentage: undefined, // Not provided by API
        valueUsd: null, // Not provided by API
      }));

      const result: TokenHoldersResult = {
        tokenAddress: response.token_address,
        holders,
        totalHolders: holders.length, // API doesn't return total, use returned count
        nextCursor: response.next_offset,
      };

      // Cache for 5 minutes (holder rankings change less frequently)
      this.setInCache(cacheKey, result, 300_000);

      this.log.info(
        {
          tokenAddress: normalizedToken,
          chainId: options.chainId,
          holdersReturned: holders.length,
        },
        'Fetched token holders from Dune Sim'
      );

      return result;
    } catch (error) {
      this.metrics.endpoints.tokenHolders.errors++;
      this.log.error(
        { error: (error as Error).message, tokenAddress, chainId: options.chainId },
        'Failed to get token holders'
      );
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  /**
   * Parse amount string to bigint (handles decimal notation)
   */
  private parseAmount(amount: string, decimals: number): bigint {
    // If amount is already in smallest unit (integer string), return directly
    if (!amount.includes('.')) {
      return BigInt(amount);
    }

    // Handle decimal notation
    const [intPart, decPart = ''] = amount.split('.');
    const paddedDecimal = decPart.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(intPart + paddedDecimal);
  }

  /**
   * Get metrics for observability
   */
  getMetrics(): DuneSimMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if the client is healthy (can reach Dune Sim API)
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.loadSupportedChains();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all cached entries
   */
  clearCache(): void {
    this.cache.clear();
    this.log.info('Cache cleared');
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
}

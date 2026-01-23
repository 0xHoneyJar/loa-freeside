/**
 * Contract Read Service
 *
 * Provides contract read functionality with caching for theme builder.
 * Sprint 3: Web3 Layer - Chain Service
 *
 * Features:
 * - Generic contract reads
 * - ERC20 balance queries
 * - NFT ownership checks
 * - Redis caching with configurable TTL
 * - Rate limiting per community/contract
 *
 * @see grimoires/loa/sdd.md §9.1 Cache Key Generation
 */

import type { Address, Abi } from 'viem';
import { isAddress, getAddress, formatUnits } from 'viem';
import { logger } from '../../utils/logger.js';
import { ThemeChainService, themeChainService } from './ThemeChainService.js';
import { isSupportedChainId } from '../../config/chains.js';
import type {
  ContractBinding,
  ContractCallResult,
  TokenBalance,
  NFTOwnership,
  ContractAbiFragment,
} from '../../types/theme-web3.types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default cache TTL in seconds (5 minutes)
 */
const DEFAULT_CACHE_TTL = 300;

/**
 * Minimum cache TTL (60 seconds)
 */
const MIN_CACHE_TTL = 60;

/**
 * Maximum cache TTL (1 hour)
 */
const MAX_CACHE_TTL = 3600;

/**
 * Cache key prefix for contract reads
 */
const CACHE_PREFIX = 'theme:contract';

/**
 * Standard ERC20 ABI for balance queries
 */
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

/**
 * Standard ERC721 ABI for ownership checks
 */
const ERC721_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

/**
 * Standard ERC1155 ABI for balance checks
 */
const ERC1155_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOfBatch',
    stateMutability: 'view',
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'ids', type: 'uint256[]' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Cache interface (to be injected - allows Redis or in-memory)
 */
export interface CacheProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * In-memory cache for testing/development
 */
class InMemoryCache implements CacheProvider {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttl: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Contract read options
 */
export interface ContractReadOptions {
  /** Override cache TTL (seconds) */
  cacheTtl?: number;
  /** Skip cache and fetch fresh data */
  skipCache?: boolean;
  /** Block number for historical reads */
  blockNumber?: bigint;
}

/**
 * Rate limit state for a contract
 */
interface RateLimitState {
  calls: number;
  windowStart: number;
}

// =============================================================================
// ContractReadService
// =============================================================================

/**
 * ContractReadService - Contract read operations with caching
 *
 * Provides cached contract read operations for the theme builder.
 * All reads are view/pure only - no state changes.
 *
 * @example
 * ```ts
 * const service = new ContractReadService(chainService, cache);
 *
 * // Get ERC20 balance
 * const balance = await service.getTokenBalance(1, wallet, tokenAddress);
 *
 * // Check NFT ownership
 * const owns = await service.ownsNFT(1, wallet, nftAddress, tokenId);
 *
 * // Generic contract read
 * const result = await service.readContract(1, address, 'balanceOf', [wallet], abi);
 * ```
 */
export class ContractReadService {
  private chainService: ThemeChainService;
  private cache: CacheProvider;
  private rateLimits: Map<string, RateLimitState> = new Map();
  private defaultCacheTtl: number;

  constructor(
    chainService: ThemeChainService = themeChainService,
    cache?: CacheProvider,
    defaultCacheTtl: number = DEFAULT_CACHE_TTL
  ) {
    this.chainService = chainService;
    this.cache = cache ?? new InMemoryCache();
    this.defaultCacheTtl = Math.max(MIN_CACHE_TTL, Math.min(MAX_CACHE_TTL, defaultCacheTtl));

    logger.debug({ defaultCacheTtl: this.defaultCacheTtl }, 'ContractReadService initialized');
  }

  // ===========================================================================
  // Generic Contract Read
  // ===========================================================================

  /**
   * Read from a contract
   *
   * @param chainId - EVM chain ID
   * @param address - Contract address
   * @param functionName - Function to call
   * @param args - Function arguments
   * @param abi - Contract ABI (function fragments)
   * @param options - Read options
   * @returns Contract call result
   */
  async readContract<T = unknown>(
    chainId: number,
    address: string,
    functionName: string,
    args: unknown[] = [],
    abi: ContractAbiFragment[] | readonly unknown[],
    options: ContractReadOptions = {}
  ): Promise<ContractCallResult<T>> {
    const startTime = Date.now();

    // Validate inputs
    if (!isSupportedChainId(chainId)) {
      return {
        success: false,
        error: `Unsupported chain ID: ${chainId}`,
        cached: false,
      };
    }

    if (!isAddress(address)) {
      return {
        success: false,
        error: `Invalid address: ${address}`,
        cached: false,
      };
    }

    // Normalize address
    const normalizedAddress = getAddress(address);

    // Generate cache key
    const cacheKey = this.generateCacheKey(chainId, normalizedAddress, functionName, args);
    const cacheTtl = options.cacheTtl ?? this.defaultCacheTtl;

    // Check cache (unless skipped)
    if (!options.skipCache) {
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          logger.debug(
            { chainId, address: normalizedAddress, functionName, cacheHit: true },
            'Contract read cache hit'
          );
          return {
            success: true,
            data: parsed.data as T,
            cached: true,
            cachedAt: parsed.cachedAt,
          };
        }
      } catch (error) {
        logger.warn({ error, cacheKey }, 'Cache read error, proceeding with fresh read');
      }
    }

    // Perform contract read
    try {
      const client = this.chainService.getClient(chainId);

      const data = await client.readContract({
        address: normalizedAddress as Address,
        abi: abi as Abi,
        functionName,
        args,
        blockNumber: options.blockNumber,
      });

      // Cache the result
      const cachedAt = new Date().toISOString();
      try {
        await this.cache.set(
          cacheKey,
          JSON.stringify({ data: this.serializeData(data), cachedAt }),
          cacheTtl
        );
      } catch (cacheError) {
        logger.warn({ error: cacheError, cacheKey }, 'Cache write error');
      }

      logger.debug(
        {
          chainId,
          address: normalizedAddress,
          functionName,
          duration: Date.now() - startTime,
        },
        'Contract read completed'
      );

      return {
        success: true,
        data: data as T,
        cached: false,
        cachedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(
        { chainId, address: normalizedAddress, functionName, error: errorMessage },
        'Contract read failed'
      );

      return {
        success: false,
        error: errorMessage,
        cached: false,
      };
    }
  }

  // ===========================================================================
  // ERC20 Token Operations
  // ===========================================================================

  /**
   * Get ERC20 token balance for a wallet
   *
   * @param chainId - EVM chain ID
   * @param walletAddress - Wallet to check
   * @param tokenAddress - ERC20 token contract
   * @param options - Read options
   * @returns Token balance with metadata
   */
  async getTokenBalance(
    chainId: number,
    walletAddress: string,
    tokenAddress: string,
    options: ContractReadOptions = {}
  ): Promise<ContractCallResult<TokenBalance>> {
    // Validate addresses
    if (!isAddress(walletAddress)) {
      return {
        success: false,
        error: `Invalid wallet address: ${walletAddress}`,
        cached: false,
      };
    }

    if (!isAddress(tokenAddress)) {
      return {
        success: false,
        error: `Invalid token address: ${tokenAddress}`,
        cached: false,
      };
    }

    const normalizedWallet = getAddress(walletAddress);
    const normalizedToken = getAddress(tokenAddress);

    try {
      const client = this.chainService.getClient(chainId);

      // Multicall for efficiency
      const [balanceResult, decimalsResult, symbolResult] = await client.multicall({
        contracts: [
          {
            address: normalizedToken as Address,
            abi: ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args: [normalizedWallet as Address],
          },
          {
            address: normalizedToken as Address,
            abi: ERC20_BALANCE_ABI,
            functionName: 'decimals',
          },
          {
            address: normalizedToken as Address,
            abi: ERC20_BALANCE_ABI,
            functionName: 'symbol',
          },
        ],
      });

      // Check for failures
      if (balanceResult.status !== 'success') {
        return {
          success: false,
          error: 'Failed to fetch balance',
          cached: false,
        };
      }

      const balance = balanceResult.result as bigint;
      const decimals = decimalsResult.status === 'success' ? (decimalsResult.result as number) : 18;
      const symbol = symbolResult.status === 'success' ? (symbolResult.result as string) : 'UNKNOWN';

      const tokenBalance: TokenBalance = {
        address: normalizedWallet as Address,
        balance: balance.toString(),
        decimals,
        symbol,
        formatted: formatUnits(balance, decimals),
      };

      return {
        success: true,
        data: tokenBalance,
        cached: false,
        cachedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage,
        cached: false,
      };
    }
  }

  // ===========================================================================
  // NFT Operations
  // ===========================================================================

  /**
   * Check if a wallet owns a specific NFT or any NFT from a collection
   *
   * @param chainId - EVM chain ID
   * @param walletAddress - Wallet to check
   * @param nftAddress - NFT contract address
   * @param tokenId - Specific token ID to check (optional - checks any ownership if not provided)
   * @param options - Read options
   * @returns Ownership result
   */
  async ownsNFT(
    chainId: number,
    walletAddress: string,
    nftAddress: string,
    tokenId?: string,
    options: ContractReadOptions = {}
  ): Promise<ContractCallResult<NFTOwnership>> {
    // Validate addresses
    if (!isAddress(walletAddress)) {
      return {
        success: false,
        error: `Invalid wallet address: ${walletAddress}`,
        cached: false,
      };
    }

    if (!isAddress(nftAddress)) {
      return {
        success: false,
        error: `Invalid NFT address: ${nftAddress}`,
        cached: false,
      };
    }

    const normalizedWallet = getAddress(walletAddress);
    const normalizedNft = getAddress(nftAddress);

    try {
      const client = this.chainService.getClient(chainId);

      if (tokenId !== undefined) {
        // Check specific token ownership (ERC721)
        const owner = await client.readContract({
          address: normalizedNft as Address,
          abi: ERC721_ABI,
          functionName: 'ownerOf',
          args: [BigInt(tokenId)],
        });

        const ownsToken = (owner as Address).toLowerCase() === normalizedWallet.toLowerCase();

        return {
          success: true,
          data: {
            address: normalizedWallet as Address,
            tokenIds: ownsToken ? [tokenId] : [],
            count: ownsToken ? 1 : 0,
          },
          cached: false,
          cachedAt: new Date().toISOString(),
        };
      } else {
        // Check if wallet owns any tokens (ERC721 balanceOf)
        const balance = await client.readContract({
          address: normalizedNft as Address,
          abi: ERC721_ABI,
          functionName: 'balanceOf',
          args: [normalizedWallet as Address],
        });

        const count = Number(balance as bigint);

        return {
          success: true,
          data: {
            address: normalizedWallet as Address,
            tokenIds: [], // Would need enumeration to get actual IDs
            count,
          },
          cached: false,
          cachedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage,
        cached: false,
      };
    }
  }

  /**
   * Check ERC1155 token balance
   *
   * @param chainId - EVM chain ID
   * @param walletAddress - Wallet to check
   * @param contractAddress - ERC1155 contract
   * @param tokenId - Token ID to check
   * @param options - Read options
   * @returns Balance result
   */
  async getERC1155Balance(
    chainId: number,
    walletAddress: string,
    contractAddress: string,
    tokenId: string,
    options: ContractReadOptions = {}
  ): Promise<ContractCallResult<bigint>> {
    if (!isAddress(walletAddress) || !isAddress(contractAddress)) {
      return {
        success: false,
        error: 'Invalid address',
        cached: false,
      };
    }

    const normalizedWallet = getAddress(walletAddress);
    const normalizedContract = getAddress(contractAddress);

    try {
      const client = this.chainService.getClient(chainId);

      const balance = await client.readContract({
        address: normalizedContract as Address,
        abi: ERC1155_ABI,
        functionName: 'balanceOf',
        args: [normalizedWallet as Address, BigInt(tokenId)],
      });

      return {
        success: true,
        data: balance as bigint,
        cached: false,
        cachedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage,
        cached: false,
      };
    }
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Invalidate cache for a specific contract/function
   */
  async invalidateCache(
    chainId: number,
    address: string,
    functionName?: string
  ): Promise<void> {
    // For targeted invalidation, we'd need to track keys
    // For now, this is a placeholder for Redis SCAN-based invalidation
    const pattern = functionName
      ? this.generateCacheKey(chainId, address, functionName, [])
      : `${CACHE_PREFIX}:${chainId}:${address.toLowerCase()}:*`;

    logger.debug({ pattern }, 'Cache invalidation requested');
    // In production with Redis: await this.cache.deletePattern(pattern);
  }

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  /**
   * Check if a contract call is rate limited
   *
   * @param contractId - Contract binding ID
   * @param binding - Contract binding with rate limit config
   * @returns true if allowed, false if rate limited
   */
  isRateLimited(contractId: string, binding: ContractBinding): boolean {
    if (!binding.rateLimit) {
      return false;
    }

    const { maxCalls, windowSeconds } = binding.rateLimit;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    let state = this.rateLimits.get(contractId);

    if (!state || now - state.windowStart > windowMs) {
      // New window
      state = { calls: 0, windowStart: now };
      this.rateLimits.set(contractId, state);
    }

    if (state.calls >= maxCalls) {
      logger.warn({ contractId, maxCalls, windowSeconds }, 'Contract rate limited');
      return true;
    }

    state.calls++;
    return false;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate cache key per SDD Section 9.1
   *
   * Format: theme:contract:{chainId}:{address}:{function}:{argsHash}
   */
  private generateCacheKey(
    chainId: number,
    address: string,
    functionName: string,
    args: unknown[]
  ): string {
    const argsHash = this.hashArgs(args);
    return `${CACHE_PREFIX}:${chainId}:${address.toLowerCase()}:${functionName}:${argsHash}`;
  }

  /**
   * Hash arguments for cache key
   */
  private hashArgs(args: unknown[]): string {
    if (args.length === 0) return 'noargs';

    const serialized = JSON.stringify(args, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });

    // Simple hash for short keys
    let hash = 0;
    for (let i = 0; i < serialized.length; i++) {
      const char = serialized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return Math.abs(hash).toString(16);
  }

  /**
   * Serialize data for caching (handles BigInt)
   */
  private serializeData(data: unknown): unknown {
    if (typeof data === 'bigint') {
      return data.toString();
    }
    if (Array.isArray(data)) {
      return data.map((item) => this.serializeData(item));
    }
    if (data !== null && typeof data === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.serializeData(value);
      }
      return result;
    }
    return data;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Default ContractReadService instance
 */
export const contractReadService = new ContractReadService();

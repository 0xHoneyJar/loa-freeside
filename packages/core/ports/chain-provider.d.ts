/**
 * Chain Provider Port Interface
 * Sprint S-15: Native Blockchain Reader & Interface
 *
 * Defines the contract for blockchain data access with a two-tier architecture:
 * - Tier 1 (Native Reader): Direct RPC calls for binary checks (always available)
 * - Tier 2 (Score Service): Complex queries via internal gRPC service (may be unavailable)
 *
 * @see SDD §6.1.2 Interface Definitions
 */
/** Ethereum-style 0x-prefixed address */
export type Address = `0x${string}`;
/** Chain identifier (EIP-155 chain ID or custom string) */
export type ChainId = number | string;
/** Asset type for eligibility checks */
export type AssetType = 'token' | 'nft' | 'native';
/** Configuration for an asset used in eligibility rules */
export interface AssetConfig {
    /** Asset type */
    type: AssetType;
    /** Contract address (for token/nft) */
    contractAddress?: Address;
    /** Chain ID where asset resides */
    chainId: ChainId;
    /** Decimal places (for token amounts) */
    decimals?: number;
    /** Human-readable name */
    name?: string;
    /** Symbol (e.g., 'ETH', 'BERA') */
    symbol?: string;
}
/** Types of on-chain actions that can be checked */
export type ActionType = 'swap' | 'stake' | 'provide_liquidity' | 'mint' | 'burn' | 'transfer' | 'vote' | 'delegate';
/** Action history check configuration */
export interface ActionHistoryConfig {
    /** Action type to check */
    action: ActionType;
    /** Protocol/contract to check against */
    protocol?: Address;
    /** Minimum times action was performed */
    minCount?: number;
    /** Time window in seconds (0 = all time) */
    timeWindowSeconds?: number;
}
/** Ranked holder information from Score Service */
export interface RankedHolder {
    /** Wallet address */
    address: Address;
    /** Rank position (1-indexed) */
    rank: number;
    /** Score value as string (to preserve precision) */
    score: string;
    /** Balance as string (BigInt serialized) */
    balance: string;
}
/** Cross-chain aggregated score */
export interface CrossChainScore {
    /** Wallet address */
    address: Address;
    /** Aggregated score across chains */
    totalScore: string;
    /** Per-chain breakdown */
    chainScores: Record<string, string>;
    /** Timestamp of computation */
    computedAt: Date;
}
/** Source of eligibility determination */
export type EligibilitySource = 'native' | 'score_service' | 'native_degraded';
/** Result of an eligibility check */
export interface EligibilityResult {
    /** Whether the address is eligible */
    eligible: boolean;
    /** Source of the determination */
    source: EligibilitySource;
    /** Confidence level (0-1, 1 = certain) */
    confidence: number;
    /** Additional details */
    details: {
        /** Tier that was matched (if any) */
        tierMatched?: string;
        /** Score value (if computed) */
        score?: number;
        /** Rank position (if computed) */
        rank?: number;
        /** Balance checked */
        balance?: string;
        /** Threshold that was checked against */
        threshold?: string;
    };
}
/**
 * Chain Provider Port Interface
 *
 * Two-tier architecture:
 * - Tier 1 methods (hasBalance, ownsNFT, getBalance): Always available via direct RPC
 * - Tier 2 methods (getRankedHolders, getAddressRank, etc.): Require Score Service
 *
 * Implementations should handle graceful degradation when Tier 2 is unavailable.
 */
export interface IChainProvider {
    /**
     * Check if an address has at least minAmount of a token
     *
     * @param chainId - Chain to check on
     * @param address - Wallet address to check
     * @param token - Token contract address
     * @param minAmount - Minimum balance required (in wei/smallest unit)
     * @returns True if balance >= minAmount
     */
    hasBalance(chainId: ChainId, address: Address, token: Address, minAmount: bigint): Promise<boolean>;
    /**
     * Check if an address owns an NFT from a collection
     *
     * @param chainId - Chain to check on
     * @param address - Wallet address to check
     * @param collection - NFT contract address
     * @param tokenId - Specific token ID to check (optional, any if omitted)
     * @returns True if address owns the NFT
     */
    ownsNFT(chainId: ChainId, address: Address, collection: Address, tokenId?: bigint): Promise<boolean>;
    /**
     * Get the exact balance of a token for an address
     *
     * @param chainId - Chain to check on
     * @param address - Wallet address to check
     * @param token - Token contract address
     * @returns Balance in wei/smallest unit
     */
    getBalance(chainId: ChainId, address: Address, token: Address): Promise<bigint>;
    /**
     * Get native token balance (ETH, BERA, MATIC, etc.)
     *
     * @param chainId - Chain to check on
     * @param address - Wallet address to check
     * @returns Balance in wei
     */
    getNativeBalance(chainId: ChainId, address: Address): Promise<bigint>;
    /**
     * Get ranked holders for an asset
     *
     * @param asset - Asset configuration
     * @param limit - Maximum number of holders to return
     * @param offset - Offset for pagination
     * @returns Array of ranked holders
     * @throws Error if Score Service is unavailable
     */
    getRankedHolders(asset: AssetConfig, limit: number, offset?: number): Promise<RankedHolder[]>;
    /**
     * Get the rank of a specific address for an asset
     *
     * @param address - Wallet address to check
     * @param asset - Asset configuration
     * @returns Rank position (1-indexed) or null if not ranked
     * @throws Error if Score Service is unavailable
     */
    getAddressRank(address: Address, asset: AssetConfig): Promise<number | null>;
    /**
     * Check if an address has performed a specific on-chain action
     *
     * @param address - Wallet address to check
     * @param config - Action history configuration
     * @returns True if action criteria met
     * @throws Error if Score Service is unavailable
     */
    checkActionHistory(address: Address, config: ActionHistoryConfig): Promise<boolean>;
    /**
     * Get aggregated score across multiple chains
     *
     * @param address - Wallet address to check
     * @param chains - Chain IDs to aggregate across
     * @returns Cross-chain score data
     * @throws Error if Score Service is unavailable
     */
    getCrossChainScore(address: Address, chains: ChainId[]): Promise<CrossChainScore>;
    /**
     * Check if Score Service (Tier 2) is available
     *
     * @returns True if Score Service is healthy
     */
    isScoreServiceAvailable(): Promise<boolean>;
    /**
     * Get the chain IDs this provider supports
     *
     * @returns Array of supported chain IDs
     */
    getSupportedChains(): ChainId[];
}
/** Configuration for a supported chain */
export interface ChainConfig {
    /** Chain ID (EIP-155) */
    chainId: ChainId;
    /** Human-readable name */
    name: string;
    /** Chain symbol */
    symbol: string;
    /** RPC endpoint URLs (in priority order) */
    rpcUrls: string[];
    /** Block explorer URL */
    explorerUrl?: string;
    /** Native token decimals */
    decimals: number;
    /** Whether this chain is a testnet */
    isTestnet: boolean;
}
/** Default chain configurations */
export declare const CHAIN_CONFIGS: Record<string, ChainConfig>;
/** Options for creating a chain provider */
export interface ChainProviderOptions {
    /** Chain configurations to support */
    chains?: ChainConfig[];
    /** Cache TTL in milliseconds */
    cacheTtlMs?: number;
    /** Request timeout in milliseconds */
    timeoutMs?: number;
    /** Enable Score Service integration */
    enableScoreService?: boolean;
    /** Score Service endpoint (if enabled) */
    scoreServiceUrl?: string;
}
//# sourceMappingURL=chain-provider.d.ts.map
/**
 * Theme Builder Web3 Types
 *
 * Types for Web3 integration: contracts, chains, gates.
 * Sprint 1: Foundation - Database Schema & Types
 *
 * @see grimoires/loa/sdd.md §4.2 Contract Binding Schema
 * @see grimoires/loa/sdd.md §4.3 Gate Configuration Schema
 */

import type { Address, Abi } from 'viem';

// =============================================================================
// Contract Binding Types
// =============================================================================

/**
 * Contract type classification
 */
export type ContractType = 'erc20' | 'erc721' | 'erc1155' | 'custom';

/**
 * ContractBinding - Web3 contract configuration
 * Stored in the `contract_bindings` table.
 */
export interface ContractBinding {
  id: string;                     // UUID v4
  name: string;                   // Human-readable name
  chainId: number;                // EVM chain ID
  address: Address;               // Contract address (checksummed)
  abi: ContractAbiFragment[];     // Contract ABI (read functions only)

  // Metadata
  type: ContractType;
  verified?: boolean;             // Etherscan verified

  // Caching
  cacheTtl: number;               // Cache TTL in seconds (min: 60)

  // Rate limiting
  rateLimit?: ContractRateLimit;
}

/**
 * ContractRateLimit - Rate limiting configuration
 */
export interface ContractRateLimit {
  maxCalls: number;               // Max calls per window
  windowSeconds: number;          // Rate limit window
}

/**
 * ContractAbiFragment - Simplified ABI fragment for read functions
 * We only support view/pure functions for security.
 */
export interface ContractAbiFragment {
  type: 'function';
  name: string;
  inputs: AbiInput[];
  outputs: AbiOutput[];
  stateMutability: 'view' | 'pure';
}

/**
 * AbiInput - Function input parameter
 */
export interface AbiInput {
  name: string;
  type: string;                   // Solidity type (address, uint256, etc.)
  components?: AbiInput[];        // For tuple types
}

/**
 * AbiOutput - Function output parameter
 */
export interface AbiOutput {
  name: string;
  type: string;
  components?: AbiOutput[];
}

/**
 * ContractBinding database row
 */
export interface ContractBindingRow {
  id: string;
  theme_id: string;
  name: string;
  chain_id: number;
  address: string;
  type: ContractType;
  abi: string;                    // JSON string
  verified: number;               // SQLite boolean (0/1)
  cache_ttl: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Chain Configuration Types
// =============================================================================

/**
 * ChainConfig - Supported chain configuration
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;                 // Primary RPC
  rpcUrls?: string[];             // Fallback RPCs
  blockExplorer?: string;
  nativeCurrency: NativeCurrency;
}

/**
 * NativeCurrency - Chain's native token configuration
 */
export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

/**
 * Pre-configured supported chains (MVP)
 */
export const SUPPORTED_CHAIN_IDS = [
  1,      // Ethereum
  42161,  // Arbitrum One
  10,     // Optimism
  8453,   // Base
  137,    // Polygon
  80094,  // Berachain
] as const;

export type SupportedChainId = typeof SUPPORTED_CHAIN_IDS[number];

/**
 * Default chain configurations
 */
export const DEFAULT_CHAIN_CONFIGS: Record<SupportedChainId, ChainConfig> = {
  1: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  10: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    blockExplorer: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  80094: {
    chainId: 80094,
    name: 'Berachain',
    rpcUrl: 'https://rpc.berachain.com',
    blockExplorer: 'https://berascan.io',
    nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
  },
};

// =============================================================================
// Gate Configuration Types
// =============================================================================

/**
 * Gate type classification
 */
export type GateType = 'token' | 'nft' | 'multi';

/**
 * GateConfig - Token/NFT gating configuration
 */
export interface GateConfig {
  type: GateType;

  // For single token/NFT gates
  contractId?: string;            // Reference to ContractBinding.id
  minBalance?: string;            // Minimum balance (bigint as string)

  // For NFT trait gates
  traits?: GateTraitFilter[];

  // For multi-condition gates
  conditions?: GateCondition[];
  operator?: 'and' | 'or';

  // Fallback behavior
  fallback?: GateFallback;
}

/**
 * GateTraitFilter - NFT trait filter
 */
export interface GateTraitFilter {
  traitType: string;
  values: string[];
}

/**
 * GateFallback - Behavior when gate check fails
 */
export interface GateFallback {
  redirect?: string;              // Redirect URL
  message?: string;               // Custom message
}

/**
 * GateCondition - Individual gate condition
 */
export interface GateCondition {
  contractId: string;
  type: GateConditionType;
  minBalance?: string;
  tokenId?: string;
  traits?: GateTraitFilter[];
}

/**
 * Gate condition type
 */
export type GateConditionType = 'balance' | 'ownership' | 'trait';

// =============================================================================
// Visibility Condition Types
// =============================================================================

/**
 * Visibility condition type
 */
export type VisibilityConditionType = 'gate' | 'role' | 'custom';

/**
 * VisibilityCondition - Component visibility rules
 */
export interface VisibilityCondition {
  type: VisibilityConditionType;
  gateId?: string;                // Reference to GateConfig (for 'gate' type)
  roleIds?: string[];             // Discord role IDs (for 'role' type)
  expression?: string;            // Custom visibility expression (for 'custom')
}

// =============================================================================
// Contract Validation Types
// =============================================================================

/**
 * ContractValidationResult - Result of contract validation
 */
export interface ContractValidationResult {
  valid: boolean;
  type?: ContractType;            // Detected contract type
  verified?: boolean;             // Is Etherscan verified
  readFunctions: string[];        // Available read functions
  errors: ContractValidationError[];
  warnings: ContractValidationWarning[];
}

/**
 * ContractValidationError - Contract validation error
 */
export interface ContractValidationError {
  code: 'INVALID_ADDRESS' | 'NOT_CONTRACT' | 'INVALID_ABI' | 'BLOCKLISTED' | 'UNSUPPORTED_CHAIN';
  message: string;
}

/**
 * ContractValidationWarning - Contract validation warning
 */
export interface ContractValidationWarning {
  code: 'NOT_VERIFIED' | 'NO_READ_FUNCTIONS' | 'COMPLEX_ABI';
  message: string;
}

// =============================================================================
// Web3 Data Fetching Types
// =============================================================================

/**
 * ContractCallRequest - Request to call a contract function
 */
export interface ContractCallRequest {
  contractId: string;             // Reference to ContractBinding.id
  functionName: string;
  args?: unknown[];
  blockNumber?: bigint;           // Specific block (default: latest)
}

/**
 * ContractCallResult - Result of a contract call
 */
export interface ContractCallResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  cached: boolean;
  cachedAt?: string;              // ISO 8601 timestamp
}

/**
 * TokenBalance - Token balance result
 */
export interface TokenBalance {
  address: Address;
  balance: string;                // bigint as string
  decimals: number;
  symbol: string;
  formatted: string;              // Human-readable balance
}

/**
 * NFTOwnership - NFT ownership result
 */
export interface NFTOwnership {
  address: Address;
  tokenIds: string[];             // Owned token IDs
  count: number;
}

/**
 * GateCheckResult - Result of a gate check
 */
export interface GateCheckResult {
  passed: boolean;
  conditions: GateConditionResult[];
  operator: 'and' | 'or';
}

/**
 * GateConditionResult - Individual condition check result
 */
export interface GateConditionResult {
  condition: GateCondition;
  passed: boolean;
  actualValue?: string;           // What the user has
  requiredValue?: string;         // What's required
  error?: string;
}

// =============================================================================
// API Input Types
// =============================================================================

/**
 * CreateContractBindingInput - Input for creating a contract binding
 */
export interface CreateContractBindingInput {
  themeId: string;
  name: string;
  chainId: number;
  address: string;
  abi?: ContractAbiFragment[];    // Auto-detected if not provided
  type?: ContractType;            // Auto-detected if not provided
  cacheTtl?: number;              // Default: 300
}

/**
 * UpdateContractBindingInput - Input for updating a contract binding
 */
export interface UpdateContractBindingInput {
  name?: string;
  abi?: ContractAbiFragment[];
  cacheTtl?: number;
}

/**
 * ValidateContractInput - Input for contract validation
 */
export interface ValidateContractInput {
  chainId: number;
  address: string;
}

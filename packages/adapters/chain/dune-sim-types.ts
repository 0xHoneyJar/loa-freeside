/**
 * Dune Sim API Type Definitions
 * Sprint 14: Dune Sim Foundation
 *
 * TypeScript types for the Dune Sim API (https://docs.sim.dune.com/)
 * Used by DuneSimClient for blockchain data queries.
 *
 * @see PRD §6.10 Dune Sim API Integration
 * @see SDD Part 5 Sections 25-35
 */

// --------------------------------------------------------------------------
// Configuration Types
// --------------------------------------------------------------------------

/** Configuration for DuneSimClient */
export interface DuneSimConfig {
  /** Dune Sim API key */
  apiKey: string;
  /** Base URL for API (default: https://api.sim.dune.com) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Maximum retry attempts for failed requests (default: 3) */
  maxRetries?: number;
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTtlMs?: number;
}

/** Resolved configuration with defaults applied */
export interface ResolvedDuneSimConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
}

// --------------------------------------------------------------------------
// Chain Support Types
// --------------------------------------------------------------------------

/** Chain information from Dune Sim */
export interface DuneChain {
  /** Chain ID (e.g., 1, 137, 80094) */
  chain_id: number;
  /** Human-readable name */
  name: string;
  /** Whether mainnet or testnet */
  is_testnet: boolean;
}

/** Response from /v1/evm/supported-chains */
export interface DuneSupportedChainsResponse {
  chains: DuneChain[];
}

// --------------------------------------------------------------------------
// Balance Types
// --------------------------------------------------------------------------

/** Single balance entry from Dune Sim API */
export interface DuneBalanceEntry {
  /** Token contract address (null for native token) */
  address: string | null;
  /** Token amount as string (high precision) */
  amount: string;
  /** Token symbol (e.g., 'ETH', 'BERA', 'USDC') */
  symbol: string;
  /** Token name (e.g., 'Ethereum', 'Berachain') */
  name: string;
  /** Decimal places for the token */
  decimals: number;
  /** USD price per token (null if unavailable) */
  price_usd: number | null;
  /** Total USD value of balance (null if price unavailable) */
  value_usd: number | null;
  /** Chain ID where token resides */
  chain_id: number;
  /** Chain name */
  chain: string;
}

/** Response from /v1/evm/balances/{address} */
export interface DuneBalancesResponse {
  /** Wallet address queried */
  address: string;
  /** List of token balances */
  balances: DuneBalanceEntry[];
  /** Any warnings about the response */
  warnings?: DuneWarning[];
}

/** Response from /v1/evm/balances/{address}/token/{token} */
export interface DuneSingleBalanceResponse {
  /** Wallet address queried */
  address: string;
  /** Token balance */
  balance: DuneBalanceEntry;
  /** Any warnings about the response */
  warnings?: DuneWarning[];
}

// --------------------------------------------------------------------------
// Collectibles (NFT) Types
// --------------------------------------------------------------------------

/** Single NFT/collectible entry */
export interface DuneCollectibleEntry {
  /** NFT contract address */
  contract_address: string;
  /** Token ID within the collection */
  token_id: string;
  /** Collection name */
  collection_name: string;
  /** NFT name/title */
  name: string | null;
  /** NFT description */
  description: string | null;
  /** Image URL */
  image_url: string | null;
  /** Token standard (ERC721, ERC1155) */
  token_standard: 'ERC721' | 'ERC1155';
  /** Amount owned (always 1 for ERC721, can be >1 for ERC1155) */
  amount: string;
  /** Chain ID where NFT resides */
  chain_id: number;
  /** Chain name */
  chain: string;
  /** Whether flagged as spam */
  is_spam: boolean;
  /** Floor price in USD (null if unavailable) */
  floor_price_usd: number | null;
}

/** Response from /v1/evm/collectibles/{address} */
export interface DuneCollectiblesResponse {
  /** Wallet address queried */
  address: string;
  /** List of owned collectibles */
  collectibles: DuneCollectibleEntry[];
  /** Pagination cursor for next page */
  next_cursor: string | null;
  /** Any warnings about the response */
  warnings?: DuneWarning[];
}

// --------------------------------------------------------------------------
// Activity Types
// --------------------------------------------------------------------------

/** Types of on-chain activity */
export type DuneActivityType =
  | 'transfer'
  | 'swap'
  | 'mint'
  | 'burn'
  | 'approval'
  | 'stake'
  | 'unstake'
  | 'claim'
  | 'deposit'
  | 'withdraw'
  | 'bridge'
  | 'contract_interaction';

/** Single activity entry */
export interface DuneActivityEntry {
  /** Transaction hash */
  tx_hash: string;
  /** Block number */
  block_number: number;
  /** Block timestamp (ISO 8601) */
  timestamp: string;
  /** Activity type */
  type: DuneActivityType;
  /** Human-readable description */
  description: string;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** Value transferred (in native token) */
  value: string;
  /** Gas used */
  gas_used: string;
  /** Gas price in gwei */
  gas_price: string;
  /** Transaction fee in native token */
  fee: string;
  /** Fee in USD */
  fee_usd: number | null;
  /** Chain ID */
  chain_id: number;
  /** Chain name */
  chain: string;
  /** Status: success or failed */
  status: 'success' | 'failed';
  /** Token transfers in this transaction */
  token_transfers?: DuneTokenTransfer[];
  /** NFT transfers in this transaction */
  nft_transfers?: DuneNFTTransfer[];
}

/** Token transfer within a transaction */
export interface DuneTokenTransfer {
  /** Token contract address */
  token_address: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Amount transferred */
  amount: string;
  /** Decimals */
  decimals: number;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** USD value at time of transfer */
  value_usd: number | null;
}

/** NFT transfer within a transaction */
export interface DuneNFTTransfer {
  /** NFT contract address */
  contract_address: string;
  /** Token ID */
  token_id: string;
  /** Collection name */
  collection_name: string;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** Amount (for ERC1155) */
  amount: string;
}

/** Response from /v1/evm/activity/{address} */
export interface DuneActivityResponse {
  /** Wallet address queried */
  address: string;
  /** List of activity entries */
  activities: DuneActivityEntry[];
  /** Pagination cursor for next page */
  next_cursor: string | null;
  /** Any warnings about the response */
  warnings?: DuneWarning[];
}

// --------------------------------------------------------------------------
// Warning and Error Types
// --------------------------------------------------------------------------

/** Warning from Dune Sim API */
export interface DuneWarning {
  /** Warning code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Additional context */
  details?: Record<string, unknown>;
}

/** Error response from Dune Sim API */
export interface DuneErrorResponse {
  /** Error code */
  error: string;
  /** Human-readable message */
  message: string;
  /** HTTP status code */
  status_code: number;
}

// --------------------------------------------------------------------------
// Metrics Types
// --------------------------------------------------------------------------

/** Metrics for DuneSimClient observability */
export interface DuneSimMetrics {
  /** Total requests made */
  requests: number;
  /** Successful requests */
  successes: number;
  /** Failed requests */
  errors: number;
  /** Rate limit hits (429 responses) */
  rateLimits: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses */
  cacheMisses: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Per-endpoint breakdown */
  endpoints: {
    balances: { requests: number; errors: number };
    collectibles: { requests: number; errors: number };
    activity: { requests: number; errors: number };
    tokenHolders: { requests: number; errors: number };
  };
}

// --------------------------------------------------------------------------
// Extended IChainProvider Types (Dune Sim exclusive)
// --------------------------------------------------------------------------

/** Balance with USD pricing information */
export interface BalanceWithUSD {
  /** Raw balance in smallest unit (wei) */
  balance: bigint;
  /** Token symbol */
  symbol: string;
  /** Token decimals */
  decimals: number;
  /** USD price per token (null if unavailable) */
  priceUsd: number | null;
  /** Total USD value (null if price unavailable) */
  valueUsd: number | null;
}

/** NFT ownership result */
export interface CollectibleOwnership {
  /** Contract address */
  contractAddress: string;
  /** Token ID */
  tokenId: string;
  /** Collection name */
  collectionName: string;
  /** Token standard */
  tokenStandard: 'ERC721' | 'ERC1155';
  /** Amount owned */
  amount: bigint;
  /** Whether flagged as spam */
  isSpam: boolean;
  /** Floor price in USD */
  floorPriceUsd: number | null;
  /** Image URL */
  imageUrl: string | null;
}

/** Activity query options */
export interface ActivityQueryOptions {
  /** Chain IDs to query (defaults to all supported) */
  chainIds?: number[];
  /** Maximum results to return */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
  /** Activity types to filter (defaults to all) */
  types?: DuneActivityType[];
}

/** Parsed activity entry with typed fields */
export interface ParsedActivity {
  /** Transaction hash */
  txHash: string;
  /** Block number */
  blockNumber: number;
  /** Timestamp */
  timestamp: Date;
  /** Activity type */
  type: DuneActivityType;
  /** Description */
  description: string;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** Value in native token (wei) */
  value: bigint;
  /** Transaction fee (wei) */
  fee: bigint;
  /** Fee in USD */
  feeUsd: number | null;
  /** Chain ID */
  chainId: number;
  /** Status */
  status: 'success' | 'failed';
}

// --------------------------------------------------------------------------
// Token Holders Types (Sprint 17)
// --------------------------------------------------------------------------

/** Single token holder entry from Dune Sim API */
export interface DuneTokenHolderEntry {
  /** Holder wallet address */
  wallet_address: string;
  /** Token balance as string (high precision) */
  balance: string;
  /** When the holder first acquired the token */
  first_acquired: string;
  /** Whether the holder has initiated any transfers */
  has_initiated_transfer: boolean;
}

/** Response from /v1/evm/token-holders/{chain_id}/{contract_address} */
export interface DuneTokenHoldersResponse {
  /** Token contract address queried */
  token_address: string;
  /** Chain ID */
  chain_id: number;
  /** List of token holders sorted by balance descending */
  holders: DuneTokenHolderEntry[];
  /** Pagination offset for next page */
  next_offset: string | null;
}

/** Parsed token holder with typed fields */
export interface TokenHolder {
  /** Holder wallet address */
  address: string;
  /** Token balance in smallest unit (wei) */
  balance: bigint;
  /** Rank by balance (1 = highest) */
  rank: number;
  /** Percentage of total supply held */
  percentage?: number;
  /** USD value of holdings */
  valueUsd: number | null;
}

/** Token holders query options */
export interface TokenHoldersQueryOptions {
  /** Chain ID (required for Token Holders API) */
  chainId: number;
  /** Maximum results to return (default: 100) */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
  /** Token decimals (default: 18). Used for balance parsing. */
  decimals?: number;
}

/** Token holders result */
export interface TokenHoldersResult {
  /** Token contract address */
  tokenAddress: string;
  /** List of token holders */
  holders: TokenHolder[];
  /** Total number of holders */
  totalHolders: number;
  /** Pagination cursor for next page */
  nextCursor: string | null;
}

// --------------------------------------------------------------------------
// Zod Validation Schemas (Sprint 17 Security Audit Remediation)
// --------------------------------------------------------------------------

import { z } from 'zod';

/** Ethereum address validation pattern */
const ethereumAddressRegex = /^0x[a-fA-F0-9]{40}$/;

/** Zod schema for Ethereum address */
export const EthereumAddressSchema = z.string().regex(
  ethereumAddressRegex,
  'Invalid Ethereum address format'
);

/** Zod schema for Token Holder entry */
export const DuneTokenHolderEntrySchema = z.object({
  wallet_address: EthereumAddressSchema,
  balance: z.string(),
  first_acquired: z.string(),
  has_initiated_transfer: z.boolean(),
});

/** Zod schema for Token Holders API response */
export const DuneTokenHoldersResponseSchema = z.object({
  token_address: EthereumAddressSchema,
  chain_id: z.number().int().positive(),
  holders: z.array(DuneTokenHolderEntrySchema),
  next_offset: z.string().nullable(),
});

/** Zod schema for Balance entry */
export const DuneBalanceEntrySchema = z.object({
  address: z.string().nullable(),
  amount: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  price_usd: z.number().nullable(),
  value_usd: z.number().nullable(),
  chain_id: z.number().int().positive(),
  chain: z.string(),
});

/** Zod schema for Single Balance API response */
export const DuneSingleBalanceResponseSchema = z.object({
  address: EthereumAddressSchema,
  balance: DuneBalanceEntrySchema,
  warnings: z.array(z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  })).optional(),
});

/** Helper to validate Ethereum address at runtime */
export function isValidEthereumAddress(address: string): boolean {
  return ethereumAddressRegex.test(address);
}

/** Helper to validate and parse Token Holders response */
export function validateTokenHoldersResponse(data: unknown): DuneTokenHoldersResponse {
  return DuneTokenHoldersResponseSchema.parse(data);
}

/** Helper to validate and parse Single Balance response */
export function validateSingleBalanceResponse(data: unknown): DuneSingleBalanceResponse {
  return DuneSingleBalanceResponseSchema.parse(data);
}

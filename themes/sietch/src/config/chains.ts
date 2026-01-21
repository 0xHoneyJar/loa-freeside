/**
 * Theme Builder Chain Configuration
 *
 * Defines supported EVM chains for the WYSIWYG theme builder.
 * Sprint 3: Web3 Layer - Chain Service
 *
 * @see grimoires/loa/sdd.md §4.2 Contract Binding Schema
 */

import { config as dotenvConfig } from 'dotenv';
import type { ChainConfig, SupportedChainId } from '../types/theme-web3.types.js';

// Load environment variables
dotenvConfig({ path: '.env.local' });
dotenvConfig();

// =============================================================================
// Supported Chain IDs
// =============================================================================

/**
 * Supported chain IDs for the theme builder
 * Order: Ethereum, L2s, then newer chains
 */
export const SUPPORTED_CHAIN_IDS = [
  1,      // Ethereum Mainnet
  42161,  // Arbitrum One
  10,     // Optimism
  8453,   // Base
  137,    // Polygon
  80094,  // Berachain
] as const;

/**
 * Type guard for supported chain IDs
 */
export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

// =============================================================================
// Environment Variable Overrides
// =============================================================================

/**
 * Get RPC URL from environment or use default
 * Allows operators to override RPCs without code changes
 */
function getRpcUrl(chainId: number, defaultUrl: string): string {
  const envKey = `THEME_RPC_${chainId}`;
  return process.env[envKey] || defaultUrl;
}

/**
 * Get fallback RPC URLs from environment
 * Format: THEME_RPC_FALLBACK_1=url1,url2,url3
 */
function getFallbackRpcUrls(chainId: number, defaultUrls: string[]): string[] {
  const envKey = `THEME_RPC_FALLBACK_${chainId}`;
  const envValue = process.env[envKey];
  if (envValue) {
    return envValue.split(',').map(url => url.trim()).filter(Boolean);
  }
  return defaultUrls;
}

// =============================================================================
// Default Chain Configurations
// =============================================================================

/**
 * Default chain configurations with fallback RPCs
 * Public endpoints are used as defaults - production should override
 */
export const CHAIN_CONFIGS: Record<SupportedChainId, ChainConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: getRpcUrl(1, 'https://eth.llamarpc.com'),
    rpcUrls: getFallbackRpcUrls(1, [
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com',
    ]),
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },

  // Arbitrum One
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: getRpcUrl(42161, 'https://arb1.arbitrum.io/rpc'),
    rpcUrls: getFallbackRpcUrls(42161, [
      'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum',
      'https://arbitrum-one.publicnode.com',
    ]),
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },

  // Optimism
  10: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: getRpcUrl(10, 'https://mainnet.optimism.io'),
    rpcUrls: getFallbackRpcUrls(10, [
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism',
      'https://optimism.publicnode.com',
    ]),
    blockExplorer: 'https://optimistic.etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },

  // Base
  8453: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: getRpcUrl(8453, 'https://mainnet.base.org'),
    rpcUrls: getFallbackRpcUrls(8453, [
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
      'https://base.publicnode.com',
    ]),
    blockExplorer: 'https://basescan.org',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },

  // Polygon
  137: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: getRpcUrl(137, 'https://polygon-rpc.com'),
    rpcUrls: getFallbackRpcUrls(137, [
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon-bor.publicnode.com',
    ]),
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18,
    },
  },

  // Berachain
  80094: {
    chainId: 80094,
    name: 'Berachain',
    rpcUrl: getRpcUrl(80094, 'https://rpc.berachain.com'),
    rpcUrls: getFallbackRpcUrls(80094, [
      'https://rpc.berachain.com',
      'https://bera-rpc.publicnode.com',
    ]),
    blockExplorer: 'https://berascan.io',
    nativeCurrency: {
      name: 'BERA',
      symbol: 'BERA',
      decimals: 18,
    },
  },
};

// =============================================================================
// Chain Lookup Functions
// =============================================================================

/**
 * Get chain configuration by ID
 * @throws Error if chain ID is not supported
 */
export function getChainConfig(chainId: number): ChainConfig {
  if (!isSupportedChainId(chainId)) {
    throw new Error(
      `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAIN_IDS.join(', ')}`
    );
  }
  return CHAIN_CONFIGS[chainId];
}

/**
 * Get chain configuration by ID (safe version)
 * @returns ChainConfig or null if not supported
 */
export function getChainConfigSafe(chainId: number): ChainConfig | null {
  if (!isSupportedChainId(chainId)) {
    return null;
  }
  return CHAIN_CONFIGS[chainId];
}

/**
 * Get chain name by ID
 */
export function getChainName(chainId: number): string {
  const config = getChainConfigSafe(chainId);
  return config?.name ?? `Unknown Chain (${chainId})`;
}

/**
 * Get all supported chain configurations
 */
export function getAllChainConfigs(): ChainConfig[] {
  return SUPPORTED_CHAIN_IDS.map(id => CHAIN_CONFIGS[id]);
}

/**
 * Get chain ID by name (case-insensitive)
 */
export function getChainIdByName(name: string): SupportedChainId | null {
  const lowerName = name.toLowerCase();
  for (const [chainId, config] of Object.entries(CHAIN_CONFIGS)) {
    if (config.name.toLowerCase() === lowerName) {
      return parseInt(chainId) as SupportedChainId;
    }
  }
  return null;
}

/**
 * Validate that a chain ID is supported
 * @throws Error with user-friendly message if not supported
 */
export function validateChainId(chainId: number): void {
  if (!isSupportedChainId(chainId)) {
    const supportedChains = getAllChainConfigs()
      .map(c => `${c.name} (${c.chainId})`)
      .join(', ');
    throw new Error(
      `Chain ID ${chainId} is not supported. Supported chains: ${supportedChains}`
    );
  }
}

// =============================================================================
// Chain Configuration Summary (for logging/debugging)
// =============================================================================

/**
 * Get a summary of chain configurations
 */
export function getChainConfigSummary(): Record<number, { name: string; rpcCount: number }> {
  const summary: Record<number, { name: string; rpcCount: number }> = {};
  for (const config of getAllChainConfigs()) {
    summary[config.chainId] = {
      name: config.name,
      rpcCount: config.rpcUrls?.length ?? 1,
    };
  }
  return summary;
}

/**
 * Chain Provider Configuration
 * Sprint 15: Dune Sim Integration & Rollout
 *
 * Configuration loader for chain provider settings.
 * Reads environment variables and provides typed configuration.
 *
 * @see PRD §6.10 Dune Sim API Integration
 * @see SDD Section 31 Environment Configuration
 */

import type { DuneSimConfig } from './dune-sim-types.js';
import type { ChainProviderOptions } from '@arrakis/core/ports';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Chain provider mode */
export type ChainProviderMode = 'rpc' | 'dune_sim' | 'hybrid';

/** Full chain provider configuration */
export interface ChainProviderConfig {
  /** Provider mode: rpc, dune_sim, or hybrid */
  mode: ChainProviderMode;

  /** Dune Sim specific configuration (required for dune_sim and hybrid modes) */
  duneSim?: DuneSimConfig;

  /** RPC specific configuration (used for rpc and hybrid modes) */
  rpc?: ChainProviderOptions;

  /** Enable fallback to RPC when Dune Sim fails (hybrid mode only) */
  fallbackEnabled: boolean;

  /** Chain IDs that should always use RPC (bypass Dune Sim) */
  rpcOnlyChains: number[];
}

// --------------------------------------------------------------------------
// Environment Variables
// --------------------------------------------------------------------------

const ENV_VARS = {
  // Dune Sim settings
  DUNE_SIM_API_KEY: 'DUNE_SIM_API_KEY',
  DUNE_SIM_BASE_URL: 'DUNE_SIM_BASE_URL',
  DUNE_SIM_TIMEOUT_MS: 'DUNE_SIM_TIMEOUT_MS',
  DUNE_SIM_MAX_RETRIES: 'DUNE_SIM_MAX_RETRIES',
  DUNE_SIM_CACHE_TTL_MS: 'DUNE_SIM_CACHE_TTL_MS',

  // Provider mode settings
  CHAIN_PROVIDER: 'CHAIN_PROVIDER',
  CHAIN_PROVIDER_FALLBACK_ENABLED: 'CHAIN_PROVIDER_FALLBACK_ENABLED',
  CHAIN_PROVIDER_RPC_ONLY_CHAINS: 'CHAIN_PROVIDER_RPC_ONLY_CHAINS',

  // RPC settings
  RPC_CACHE_TTL_MS: 'RPC_CACHE_TTL_MS',
  RPC_TIMEOUT_MS: 'RPC_TIMEOUT_MS',
} as const;

// --------------------------------------------------------------------------
// Default Values
// --------------------------------------------------------------------------

const DEFAULTS = {
  mode: 'rpc' as ChainProviderMode,
  baseUrl: 'https://api.sim.dune.com',
  timeoutMs: 10_000,
  maxRetries: 3,
  cacheTtlMs: 60_000,
  fallbackEnabled: true,
  rpcCacheTtlMs: 300_000, // 5 minutes
  rpcTimeoutMs: 10_000,
};

// --------------------------------------------------------------------------
// Configuration Loader
// --------------------------------------------------------------------------

/**
 * Load chain provider configuration from environment variables
 *
 * Environment variables:
 * - CHAIN_PROVIDER: Provider mode (rpc|dune_sim|hybrid), default: rpc
 * - DUNE_SIM_API_KEY: API key for Dune Sim (required for dune_sim/hybrid)
 * - DUNE_SIM_BASE_URL: API base URL, default: https://api.sim.dune.com
 * - DUNE_SIM_TIMEOUT_MS: Request timeout, default: 10000
 * - DUNE_SIM_MAX_RETRIES: Max retry attempts, default: 3
 * - DUNE_SIM_CACHE_TTL_MS: Cache TTL, default: 60000
 * - CHAIN_PROVIDER_FALLBACK_ENABLED: Enable RPC fallback, default: true
 * - CHAIN_PROVIDER_RPC_ONLY_CHAINS: Comma-separated chain IDs for RPC-only
 */
export function loadChainProviderConfig(
  env: Record<string, string | undefined> = process.env
): ChainProviderConfig {
  // Parse provider mode
  const modeStr = env[ENV_VARS.CHAIN_PROVIDER]?.toLowerCase() ?? DEFAULTS.mode;
  const mode = parseProviderMode(modeStr);

  // Parse RPC-only chains
  const rpcOnlyChainsStr = env[ENV_VARS.CHAIN_PROVIDER_RPC_ONLY_CHAINS] ?? '';
  const rpcOnlyChains = parseChainIds(rpcOnlyChainsStr);

  // Parse fallback setting
  const fallbackStr = env[ENV_VARS.CHAIN_PROVIDER_FALLBACK_ENABLED];
  const fallbackEnabled = fallbackStr === undefined ? DEFAULTS.fallbackEnabled : fallbackStr === 'true';

  // Build config based on mode
  const config: ChainProviderConfig = {
    mode,
    fallbackEnabled,
    rpcOnlyChains,
  };

  // Add Dune Sim config if needed
  if (mode === 'dune_sim' || mode === 'hybrid') {
    const apiKey = env[ENV_VARS.DUNE_SIM_API_KEY];

    if (!apiKey && mode === 'dune_sim') {
      throw new Error(
        'DUNE_SIM_API_KEY is required when CHAIN_PROVIDER=dune_sim. ' +
          'Get an API key from https://sim.dune.com/'
      );
    }

    if (apiKey) {
      config.duneSim = {
        apiKey,
        baseUrl: env[ENV_VARS.DUNE_SIM_BASE_URL] ?? DEFAULTS.baseUrl,
        timeoutMs: parseIntOrDefault(env[ENV_VARS.DUNE_SIM_TIMEOUT_MS], DEFAULTS.timeoutMs),
        maxRetries: parseIntOrDefault(env[ENV_VARS.DUNE_SIM_MAX_RETRIES], DEFAULTS.maxRetries),
        cacheTtlMs: parseIntOrDefault(env[ENV_VARS.DUNE_SIM_CACHE_TTL_MS], DEFAULTS.cacheTtlMs),
      };
    }
  }

  // Add RPC config if needed
  if (mode === 'rpc' || mode === 'hybrid') {
    config.rpc = {
      cacheTtlMs: parseIntOrDefault(env[ENV_VARS.RPC_CACHE_TTL_MS], DEFAULTS.rpcCacheTtlMs),
      timeoutMs: parseIntOrDefault(env[ENV_VARS.RPC_TIMEOUT_MS], DEFAULTS.rpcTimeoutMs),
    };
  }

  return config;
}

/**
 * Validate chain provider configuration
 *
 * @throws Error if configuration is invalid
 */
export function validateChainProviderConfig(config: ChainProviderConfig): void {
  // Validate mode-specific requirements
  if (config.mode === 'dune_sim' && !config.duneSim?.apiKey) {
    throw new Error('Dune Sim API key is required for dune_sim mode');
  }

  if (config.mode === 'hybrid' && !config.duneSim?.apiKey) {
    throw new Error('Dune Sim API key is required for hybrid mode');
  }

  // Validate numeric values
  if (config.duneSim) {
    if (config.duneSim.timeoutMs !== undefined && config.duneSim.timeoutMs <= 0) {
      throw new Error('DUNE_SIM_TIMEOUT_MS must be a positive number');
    }
    if (config.duneSim.maxRetries !== undefined && config.duneSim.maxRetries < 0) {
      throw new Error('DUNE_SIM_MAX_RETRIES must be non-negative');
    }
    if (config.duneSim.cacheTtlMs !== undefined && config.duneSim.cacheTtlMs < 0) {
      throw new Error('DUNE_SIM_CACHE_TTL_MS must be non-negative');
    }
  }
}

// --------------------------------------------------------------------------
// Helper Functions
// --------------------------------------------------------------------------

/**
 * Parse provider mode string
 */
function parseProviderMode(mode: string): ChainProviderMode {
  switch (mode) {
    case 'rpc':
    case 'dune_sim':
    case 'hybrid':
      return mode;
    default:
      console.warn(`Unknown CHAIN_PROVIDER value "${mode}", defaulting to "rpc"`);
      return 'rpc';
  }
}

/**
 * Parse comma-separated chain IDs
 */
function parseChainIds(str: string): number[] {
  if (!str.trim()) {
    return [];
  }

  return str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const num = parseInt(s, 10);
      if (isNaN(num)) {
        console.warn(`Invalid chain ID "${s}", skipping`);
        return null;
      }
      return num;
    })
    .filter((n): n is number => n !== null);
}

/**
 * Parse integer or return default
 */
function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  const num = parseInt(value, 10);
  if (isNaN(num)) {
    console.warn(`Invalid number "${value}", using default ${defaultValue}`);
    return defaultValue;
  }

  return num;
}

// --------------------------------------------------------------------------
// Utility Functions
// --------------------------------------------------------------------------

/**
 * Check if Dune Sim is configured and available
 */
export function isDuneSimConfigured(config: ChainProviderConfig): boolean {
  return (
    (config.mode === 'dune_sim' || config.mode === 'hybrid') &&
    !!config.duneSim?.apiKey
  );
}

/**
 * Check if a chain should use RPC directly (bypassing Dune Sim)
 */
export function shouldUseRpcForChain(config: ChainProviderConfig, chainId: number): boolean {
  // Always use RPC in RPC mode
  if (config.mode === 'rpc') {
    return true;
  }

  // Check if chain is in RPC-only list
  return config.rpcOnlyChains.includes(chainId);
}

/**
 * Get a summary of the configuration for logging
 */
export function getConfigSummary(config: ChainProviderConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    duneSimConfigured: !!config.duneSim?.apiKey,
    duneSimBaseUrl: config.duneSim?.baseUrl,
    fallbackEnabled: config.fallbackEnabled,
    rpcOnlyChains: config.rpcOnlyChains,
  };
}

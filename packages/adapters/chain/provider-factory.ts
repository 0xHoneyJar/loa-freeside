/**
 * Chain Provider Factory
 * Sprint 15: Dune Sim Integration & Rollout
 *
 * Factory function for creating chain provider instances based on configuration.
 * Supports three modes: rpc (direct RPC), dune_sim (Dune Sim API), and hybrid.
 *
 * @see PRD §6.10 Dune Sim API Integration
 * @see SDD Section 29 Provider Factory
 */

import type { Logger } from 'pino';
import type { IChainProvider } from '@arrakis/core/ports';
import { NativeBlockchainReader } from './native-reader.js';
import { DuneSimClient } from './dune-sim-client.js';
import { HybridChainProvider } from './hybrid-provider.js';
import {
  loadChainProviderConfig,
  validateChainProviderConfig,
  getConfigSummary,
  type ChainProviderConfig,
  type ChainProviderMode,
} from './config.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Options for creating a chain provider */
export interface CreateChainProviderOptions {
  /** Override the provider mode from environment */
  mode?: ChainProviderMode;
  /** Override Dune Sim API key from environment */
  apiKey?: string;
  /** Override configuration (merged with environment) */
  config?: Partial<ChainProviderConfig>;
}

/** Result of creating a chain provider */
export interface ChainProviderResult {
  /** The chain provider instance */
  provider: IChainProvider;
  /** The provider mode that was used */
  mode: ChainProviderMode;
  /** Configuration summary (safe for logging) */
  configSummary: Record<string, unknown>;
}

// --------------------------------------------------------------------------
// Factory Function
// --------------------------------------------------------------------------

/**
 * Create a chain provider based on environment configuration
 *
 * Usage:
 * ```typescript
 * const { provider, mode } = createChainProvider(logger);
 * const balance = await provider.getBalance(80094, address, token);
 * ```
 *
 * @param logger - Pino logger instance
 * @param options - Optional overrides for configuration
 * @returns Chain provider instance and metadata
 */
export function createChainProvider(
  logger: Logger,
  options: CreateChainProviderOptions = {}
): ChainProviderResult {
  const log = logger.child({ component: 'ChainProviderFactory' });

  // Load configuration from environment
  let config = loadChainProviderConfig();

  // Apply overrides
  if (options.mode) {
    config = { ...config, mode: options.mode };
  }

  if (options.apiKey && (config.mode === 'dune_sim' || config.mode === 'hybrid')) {
    config = {
      ...config,
      duneSim: {
        ...config.duneSim,
        apiKey: options.apiKey,
      } as typeof config.duneSim,
    };
  }

  if (options.config) {
    config = { ...config, ...options.config };
  }

  // Validate configuration
  validateChainProviderConfig(config);

  const summary = getConfigSummary(config);
  log.info({ ...summary, mode: config.mode }, 'Creating chain provider');

  // Create provider based on mode
  let provider: IChainProvider;

  switch (config.mode) {
    case 'dune_sim':
      if (!config.duneSim) {
        throw new Error('Dune Sim configuration required for dune_sim mode');
      }
      provider = new DuneSimClient(logger, config.duneSim);
      log.info('Created DuneSimClient provider');
      break;

    case 'hybrid':
      if (!config.duneSim) {
        throw new Error('Dune Sim configuration required for hybrid mode');
      }
      provider = new HybridChainProvider(logger, {
        duneSim: config.duneSim,
        rpc: config.rpc,
        rpcOnlyChains: config.rpcOnlyChains,
        fallbackEnabled: config.fallbackEnabled,
      });
      log.info('Created HybridChainProvider');
      break;

    case 'rpc':
    default:
      provider = new NativeBlockchainReader(logger, config.rpc);
      log.info('Created NativeBlockchainReader provider');
      break;
  }

  return {
    provider,
    mode: config.mode,
    configSummary: summary,
  };
}

/**
 * Create a chain provider for testing purposes
 *
 * Always creates an RPC provider regardless of environment.
 * Useful for unit tests that shouldn't hit external APIs.
 */
export function createTestChainProvider(logger: Logger): IChainProvider {
  return new NativeBlockchainReader(logger, {
    cacheTtlMs: 0, // No caching in tests
    timeoutMs: 5000,
  });
}

/**
 * Check if Dune Sim is available based on environment
 *
 * Returns true if DUNE_SIM_API_KEY is set and mode is dune_sim or hybrid.
 */
export function isDuneSimAvailable(
  env: Record<string, string | undefined> = process.env
): boolean {
  const apiKey = env.DUNE_SIM_API_KEY;
  const mode = (env.CHAIN_PROVIDER ?? 'rpc').toLowerCase();

  return !!apiKey && (mode === 'dune_sim' || mode === 'hybrid');
}

/**
 * Get the current provider mode from environment
 */
export function getProviderMode(
  env: Record<string, string | undefined> = process.env
): ChainProviderMode {
  const mode = (env.CHAIN_PROVIDER ?? 'rpc').toLowerCase();

  switch (mode) {
    case 'dune_sim':
    case 'hybrid':
      return mode;
    default:
      return 'rpc';
  }
}

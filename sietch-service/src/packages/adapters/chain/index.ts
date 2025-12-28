/**
 * Chain Adapters - Blockchain Integration
 *
 * Two-Tier Chain Provider implementation:
 * - Tier 1: NativeBlockchainReader (viem)
 * - Tier 2: ScoreServiceAdapter (opossum circuit breaker)
 * - Orchestrator: TwoTierChainProvider
 *
 * @module packages/adapters/chain
 */

export { NativeBlockchainReader, createNativeReader } from './NativeBlockchainReader.js';
export { ScoreServiceAdapter, createScoreServiceAdapter } from './ScoreServiceAdapter.js';
export { TwoTierChainProvider, createTwoTierChainProvider } from './TwoTierChainProvider.js';

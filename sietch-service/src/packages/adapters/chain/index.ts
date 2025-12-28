/**
 * Chain Adapters - Blockchain Integration
 *
 * Two-Tier Chain Provider implementation:
 * - Tier 1: NativeBlockchainReader (viem)
 * - Tier 2: ScoreServiceAdapter (Sprint 35)
 * - Orchestrator: TwoTierChainProvider (Sprint 35)
 *
 * @module packages/adapters/chain
 */

export { NativeBlockchainReader, createNativeReader } from './NativeBlockchainReader.js';

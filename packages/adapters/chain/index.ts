/**
 * Chain Adapters
 * Sprint S-15: Native Blockchain Reader & Interface
 * Sprint S-16: Score Service & Two-Tier Orchestration
 * Sprint 14 (177): Dune Sim Foundation
 * Sprint 15 (178): Dune Sim Integration & Rollout
 *
 * Exports chain provider implementations for the two-tier architecture:
 * - Tier 1: NativeBlockchainReader (RPC-based, always available)
 * - Tier 1: DuneSimClient (API-based, unified multi-chain)
 * - Tier 1: HybridChainProvider (Dune Sim + RPC fallback)
 * - Tier 2: ScoreServiceClient (complex queries)
 * - Orchestrator: TwoTierChainProvider (unified access)
 */

// Tier 1: Native Blockchain Reader (RPC)
export * from './native-reader.js';

// Tier 1: Dune Sim Client (API)
export * from './dune-sim-client.js';
export * from './dune-sim-types.js';

// Tier 1: Hybrid Provider (Dune Sim + RPC fallback)
export * from './hybrid-provider.js';

// Configuration and Factory
export * from './config.js';
export * from './provider-factory.js';

// Tier 2: Score Service Client
export * from './score-service-client.js';

// Orchestrator: Two-Tier Provider
export * from './two-tier-provider.js';

// Metrics
export * from './metrics.js';
export * from './dune-sim-metrics.js';

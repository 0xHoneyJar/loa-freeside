/**
 * Coexistence Adapters - Shadow Mode, Incumbent Detection & Parallel Roles
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 * Sprint 58: Parallel Mode - Namespaced Role Management
 *
 * This module provides adapters for coexisting with incumbent token-gating
 * solutions (Collab.Land, Matrica, Guild.xyz) during migration.
 *
 * Components:
 * - CoexistenceStorage: PostgreSQL storage for incumbent configs, migration states, shadow ledger, parallel roles
 * - IncumbentDetector: Detects incumbent bots using multiple methods
 * - ShadowLedger: Tracks divergences between incumbent and Arrakis access
 * - ParallelRoleManager: Manages namespaced @arrakis-* roles in parallel mode
 *
 * @module packages/adapters/coexistence
 */

// Storage adapter
export {
  CoexistenceStorage,
  createCoexistenceStorage,
} from './CoexistenceStorage.js';

// Incumbent detector
export {
  IncumbentDetector,
  createIncumbentDetector,
  KNOWN_INCUMBENTS,
  CONFIDENCE,
  type DetectionResult,
  type DetectionOptions,
} from './IncumbentDetector.js';

// Shadow ledger (Sprint 57)
export {
  ShadowLedger,
  createShadowLedger,
  type ShadowSyncOptions,
  type ShadowSyncResult,
  type ArrakisPrediction,
  type GetArrakisPredictions,
} from './ShadowLedger.js';

// Parallel role manager (Sprint 58)
export {
  ParallelRoleManager,
  createParallelRoleManager,
  DEFAULT_NAMESPACE,
  DEFAULT_TIER_MAPPINGS,
  type ParallelSetupOptions,
  type ParallelSetupResult,
  type ParallelSyncOptions,
  type ParallelSyncResult,
  type GetMemberTier,
  type GetMemberTiersBatch,
} from './ParallelRoleManager.js';

/**
 * Coexistence Adapters - Shadow Mode, Incumbent Detection, Parallel Roles & Channels
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 * Sprint 58: Parallel Mode - Namespaced Role Management
 * Sprint 59: Parallel Mode - Channels & Conviction Gates
 * Sprint 61: Glimpse Mode - Social Layer Preview
 *
 * This module provides adapters for coexisting with incumbent token-gating
 * solutions (Collab.Land, Matrica, Guild.xyz) during migration.
 *
 * Components:
 * - CoexistenceStorage: PostgreSQL storage for incumbent configs, migration states, shadow ledger, parallel roles/channels
 * - IncumbentDetector: Detects incumbent bots using multiple methods
 * - ShadowLedger: Tracks divergences between incumbent and Arrakis access
 * - ParallelRoleManager: Manages namespaced @arrakis-* roles in parallel mode
 * - ParallelChannelManager: Manages conviction-gated channels in parallel mode
 * - GlimpseMode: Shows blurred/locked previews of social features
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

// Parallel channel manager (Sprint 59)
export {
  ParallelChannelManager,
  createParallelChannelManager,
  DEFAULT_CATEGORY_NAME,
  DEFAULT_CHANNEL_TEMPLATES,
  type ChannelSetupOptions,
  type ChannelSetupResult,
  type ChannelAccessSyncOptions,
  type ChannelAccessSyncResult,
  type GetMemberConviction,
  type GetMemberConvictionsBatch,
} from './ParallelChannelManager.js';

// Glimpse mode (Sprint 61)
export {
  GlimpseMode,
  createGlimpseMode,
  type GlimpseProfile,
  type LockedBadge,
  type GlimpseBadgeShowcase,
  type OwnPreviewProfile,
  type ConvictionRankResult,
  type UpgradeCTA,
  type TellAdminRequest,
} from './GlimpseMode.js';

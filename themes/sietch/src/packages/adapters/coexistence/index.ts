/**
 * Coexistence Adapters - Shadow Mode, Incumbent Detection, Parallel Roles & Channels
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 * Sprint 58: Parallel Mode - Namespaced Role Management
 * Sprint 59: Parallel Mode - Channels & Conviction Gates
 * Sprint 61: Glimpse Mode - Social Layer Preview
 * Sprint 62: Migration Engine - Strategy Selection & Execution
 * Sprint 63: Migration Engine - Rollback & Takeover
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
 * - MigrationEngine: Orchestrates migration with strategy selection, rollback, and takeover
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

// Migration engine (Sprint 62 + Sprint 63)
export {
  MigrationEngine,
  createMigrationEngine,
  // Sprint 62 constants
  MIN_SHADOW_DAYS,
  MIN_ACCURACY_PERCENT,
  DEFAULT_BATCH_SIZE,
  DEFAULT_GRADUAL_DURATION_DAYS,
  // Sprint 63 constants - Rollback thresholds
  AUTO_ROLLBACK_ACCESS_LOSS_PERCENT,
  AUTO_ROLLBACK_ERROR_RATE_PERCENT,
  ACCESS_LOSS_WINDOW_MS,
  ERROR_RATE_WINDOW_MS,
  MAX_AUTO_ROLLBACKS,
  // Sprint 62 types
  type ReadinessCheckResult,
  type MigrationPlan,
  type MigrationExecutionOptions,
  type MigrationExecutionResult,
  type GradualBatchInfo,
  type ApplyRolesCallback,
  type GetGuildMembersCallback,
  // Sprint 63 types - Rollback
  type RollbackTrigger,
  type RollbackOptions,
  type RollbackResult,
  type AccessMetrics,
  type ErrorMetrics,
  type AutoRollbackCheckResult,
  // Sprint 63 types - Takeover
  type TakeoverStep,
  type TakeoverConfirmationState,
  type TakeoverResult,
  type RenameRolesCallback,
  type NotifyAdminCallback as MigrationNotifyAdminCallback,
} from './MigrationEngine.js';

// Incumbent health monitor (Sprint 64)
export {
  IncumbentHealthMonitor,
  createIncumbentHealthMonitor,
  // Constants
  BOT_ONLINE_ALERT_MS,
  ROLE_UPDATE_ALERT_MS,
  ROLE_UPDATE_CRITICAL_MS,
  CHANNEL_ACTIVITY_ALERT_MS,
  ALERT_THROTTLE_MS,
  MIN_CHANNEL_ACTIVITY_MESSAGES,
  // Types
  type HealthCheckResult,
  type HealthReport,
  type HealthAlert,
  type NotifyAdminCallback,
  type ActivateBackupCallback,
  type HealthMonitorConfig,
} from './IncumbentHealthMonitor.js';

// Coexistence metrics (Sprint 65)
export {
  // Recording functions
  recordModeTransition,
  recordDivergence,
  recordDivergenceResolved,
  recordMigrationStart,
  recordMigrationComplete,
  recordRollback,
  recordTakeoverComplete,
  recordHealthCheck,
  recordAlertSent,
  recordEmergencyBackup,
  recordSocialLayerUnlock,
  recordFeatureUnlock,
  recordDiscountGenerated,
  recordDiscountRedeemed,
  recordDiscountExpired,
  // Bulk update functions
  setCommunitiesInMode,
  setDivergenceCounts,
  // Export function
  getCoexistenceMetrics,
  // Testing utilities
  resetMetrics,
  getMetricsState,
} from './CoexistenceMetrics.js';

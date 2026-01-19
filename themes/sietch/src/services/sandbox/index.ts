/**
 * Sandbox Services - QA Sandbox Testing System
 *
 * Sprint 106: SimulationContext Foundation
 *
 * Exports all simulation-related services and types for QA testing
 * within sandbox environments.
 *
 * @module services/sandbox
 */

// Simulation Context types and factories
export {
  // Types
  type TierId,
  type EngagementStage,
  type BadgeId,
  type AssumedRole,
  type ThresholdOverrides,
  type SimulatedMemberState,
  type SimulationContext,
  // Constants
  DEFAULT_BGT_THRESHOLDS,
  TIER_ORDER,
  TIER_DISPLAY_NAMES,
  BADGE_DISPLAY_NAMES,
  // Factory functions
  createDefaultMemberState,
  createDefaultThresholdOverrides,
  createSimulationContext,
  createAssumedRole,
  // Helpers
  getDefaultRankForTier,
  isValidTierId,
  isValidBadgeId,
  isValidEngagementStage,
  getEffectiveThresholds,
  calculateTierFromBgt,
  compareTiers,
  tierMeetsRequirement,
} from './simulation-context.js';

// Simulation Service
export {
  // Constants
  SIMULATION_KEY_PREFIX,
  SIMULATION_KEY_PATTERN,
  DEFAULT_CONTEXT_TTL_SECONDS,
  // Types
  SimulationErrorCode,
  SimulationError,
  type SimulationResult,
  type SimulationContextOptions,
  type TierSource,
  type TierInfo,
  type WhoamiResult,
  type StateUpdateResult,
  // Sprint 109: Permission Check Types
  type BlurLevel,
  type AccessCheckResult,
  type TierCheckResult,
  type BadgeCheckResult,
  // MinimalRedis interface for sandbox operations
  type MinimalRedis,
  // Serialization
  serializeContext,
  deserializeContext,
  buildContextKey,
  // Service
  SimulationService,
  createSimulationService,
} from './simulation-service.js';

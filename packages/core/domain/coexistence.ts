/**
 * Coexistence Domain Types
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Defines the core domain types for shadow mode coexistence,
 * including incumbent detection, shadow ledger, and divergence tracking.
 *
 * @see SDD §7.1 Shadow Mode Architecture
 */

// =============================================================================
// Incumbent Detection Types
// =============================================================================

/**
 * Known incumbent token-gating providers.
 */
export type IncumbentType = 'collabland' | 'matrica' | 'guild_xyz' | 'other' | 'none';

/**
 * Evidence type for incumbent detection.
 */
export type EvidenceType = 'bot_id' | 'channel_name' | 'role_name' | 'role_membership';

/**
 * Evidence item supporting incumbent detection.
 */
export interface Evidence {
  /** Type of evidence */
  type: EvidenceType;
  /** Evidence value (e.g., "collabland:703886990948565003") */
  value: string;
  /** Confidence score for this evidence (0-1) */
  confidence: number;
}

/**
 * Result of incumbent detection for a guild.
 */
export interface IncumbentInfo {
  /** Detected incumbent type */
  type: IncumbentType;
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Supporting evidence items */
  evidence: Evidence[];
}

// =============================================================================
// Shadow Ledger Types
// =============================================================================

/**
 * Shadow member state - tracks incumbent vs Arrakis eligibility.
 */
export interface ShadowMemberState {
  /** Discord guild ID */
  guildId: string;
  /** Discord user ID */
  userId: string;
  /** Snapshot of current incumbent-assigned roles */
  incumbentRoles: Set<string>;
  /** Would Arrakis grant access? */
  arrakisEligible: boolean;
  /** What tier would Arrakis assign? */
  arrakisTier: string | null;
  /** Conviction score from Arrakis */
  convictionScore: number | null;
  /** Does incumbent state differ from Arrakis? */
  divergenceFlag: boolean;
  /** Last sync timestamp */
  lastSyncAt: Date;
}

/**
 * Type of divergence between incumbent and Arrakis.
 */
export type DivergenceType = 'false_positive' | 'false_negative';

/**
 * Divergence record between incumbent and Arrakis states.
 */
export interface ShadowDivergence {
  /** Discord guild ID */
  guildId: string;
  /** Discord user ID */
  userId: string;
  /** When divergence was detected */
  detectedAt: Date;
  /** Incumbent state (JSON serialized) */
  incumbentState: string;
  /** Arrakis state (JSON serialized) */
  arrakisState: string;
  /** Type of divergence */
  divergenceType: DivergenceType;
  /** Has divergence been resolved? */
  resolved: boolean;
  /** When resolved */
  resolvedAt: Date | null;
}

/**
 * Prediction type for accuracy validation.
 */
export type PredictionType = 'role_grant' | 'role_revoke' | 'tier_change';

/**
 * Prediction record for accuracy tracking.
 */
export interface ShadowPrediction {
  /** Unique prediction ID */
  predictionId: string;
  /** Discord guild ID */
  guildId: string;
  /** Discord user ID */
  userId: string;
  /** When prediction was made */
  predictedAt: Date;
  /** Type of prediction */
  predictionType: PredictionType;
  /** Predicted value */
  predictedValue: string;
  /** When prediction was verified */
  verifiedAt: Date | null;
  /** Actual value observed */
  actualValue: string | null;
  /** Was prediction correct? */
  correct: boolean | null;
}

// =============================================================================
// Shadow Sync Types
// =============================================================================

/**
 * Result of a shadow sync operation.
 */
export interface ShadowSyncResult {
  /** Community ID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** When sync completed */
  syncedAt: Date;
  /** Number of members processed */
  membersProcessed: number;
  /** Number of divergences found */
  divergencesFound: number;
  /** Number of predictions validated */
  predictionsValidated: number;
  /** Overall accuracy (0-1) */
  accuracy: number;
}

/**
 * Incumbent state snapshot for comparison.
 */
export interface IncumbentState {
  /** Does member have incumbent role? */
  hasRole: boolean;
  /** All roles the member has */
  roles: string[];
}

/**
 * Arrakis eligibility calculation result.
 */
export interface ArrakisEligibilityResult {
  /** Is member eligible? */
  eligible: boolean;
  /** Assigned tier */
  tier: string | null;
  /** Conviction score */
  score: number | null;
  /** Source of eligibility check (optional for shadow comparisons) */
  source?: 'native' | 'score_service' | 'native_degraded';
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Coexistence mode for a community.
 */
export type CoexistenceMode = 'shadow' | 'parallel' | 'primary' | 'disabled';

/**
 * Coexistence configuration for a community.
 */
export interface CoexistenceConfig {
  /** Community ID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Current coexistence mode */
  mode: CoexistenceMode;
  /** Detected incumbent info */
  incumbentInfo: IncumbentInfo | null;
  /** Shadow sync interval in hours */
  syncIntervalHours: number;
  /** Last shadow sync time */
  lastSyncAt: Date | null;
  /** Shadow mode accuracy over time */
  shadowAccuracy: number | null;
  /** Days in shadow mode */
  shadowDays: number;
  /** Minimum accuracy required for parallel mode (0-1) */
  minAccuracyForParallel: number;
  /** Minimum shadow days required for parallel mode */
  minShadowDaysForParallel: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Known bot IDs for incumbent providers.
 */
export const KNOWN_INCUMBENT_BOTS: Record<Exclude<IncumbentType, 'other' | 'none'>, string[]> = {
  collabland: ['703886990948565003', '704521096837464076'],
  matrica: ['879673158287544361'],
  guild_xyz: ['868172385000509460'],
};

/**
 * Channel name patterns for incumbent detection.
 */
export const INCUMBENT_CHANNEL_PATTERNS: Record<Exclude<IncumbentType, 'other' | 'none'>, RegExp> = {
  collabland: /collabland-join|collab-land|cl-verify/i,
  matrica: /matrica-verify|matrica-join/i,
  guild_xyz: /guild-verify|guild-join/i,
};

/**
 * Role name patterns for incumbent detection.
 * Patterns are ordered from most specific to least specific.
 * Note: "holder" and "verified" are generic terms used by Collab.Land,
 * but we check for more specific matrica/guild patterns first.
 */
export const INCUMBENT_ROLE_PATTERNS: Record<Exclude<IncumbentType, 'other' | 'none'>, RegExp> = {
  // Matrica-specific pattern (must not match generic "verified")
  matrica: /matrica/i,
  // Guild.xyz-specific pattern (must not match generic "member")
  guild_xyz: /guild\.xyz|guildxyz/i,
  // Collab.Land uses generic terms like holder, verified, collab
  collabland: /collab|holder|verified/i,
};

/**
 * Evidence confidence weights by type.
 */
export const EVIDENCE_CONFIDENCE_WEIGHTS: Record<EvidenceType, number> = {
  bot_id: 0.95,
  channel_name: 0.7,
  role_name: 0.5,
  role_membership: 0.3,
};

/**
 * Default shadow sync interval (6 hours per SDD §7.1.4).
 */
export const DEFAULT_SHADOW_SYNC_INTERVAL_HOURS = 6;

/**
 * Default minimum accuracy for parallel mode (95% per SDD).
 */
export const DEFAULT_MIN_ACCURACY_FOR_PARALLEL = 0.95;

/**
 * Default minimum shadow days for parallel mode (14 days per SDD).
 */
export const DEFAULT_MIN_SHADOW_DAYS_FOR_PARALLEL = 14;

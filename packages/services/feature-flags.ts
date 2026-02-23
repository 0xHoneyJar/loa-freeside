/**
 * Feature Flag Infrastructure — Ostrom Protocol Feature Gating
 *
 * Environment-variable-based feature flags for the four Ostrom Protocol
 * features with per-community override capability.
 *
 * Flags:
 *   FEATURE_PURPOSE_TRACKING  — F-1 Economic Memory
 *   FEATURE_VELOCITY_ALERTS   — F-2 Temporal Dimension
 *   FEATURE_EVENT_SOURCING    — F-3 Event Formalization
 *   FEATURE_GOVERNANCE        — F-4 Governance Layer
 *   SEQUENCE_LOCK_MODE        — Event sourcing contention tier
 *
 * @see SDD §4.5 Feature Flag Architecture
 * @see Sprint 1, Task 1.5
 * @module packages/services/feature-flags
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Ostrom Protocol feature flags */
export interface OstromFeatureFlags {
  /** F-1: Purpose tracking on economic operations */
  FEATURE_PURPOSE_TRACKING: boolean;
  /** F-2: Velocity computation and exhaustion alerts */
  FEATURE_VELOCITY_ALERTS: boolean;
  /** F-3: Event sourcing with monotonic sequencing */
  FEATURE_EVENT_SOURCING: boolean;
  /** F-4: Governance outbox and policy lifecycle */
  FEATURE_GOVERNANCE: boolean;
  /** Contention tier for sequence allocation */
  SEQUENCE_LOCK_MODE: SequenceLockMode;
}

/** Sequence lock contention tiers */
export type SequenceLockMode = 'for_update' | 'advisory_lock' | 'range_allocation';

/** Per-community override */
export interface CommunityFlagOverride {
  communityId: string;
  flag: keyof Omit<OstromFeatureFlags, 'SEQUENCE_LOCK_MODE'>;
  enabled: boolean;
  reason: string;
  expiresAt?: Date;
}

// --------------------------------------------------------------------------
// Singleton State
// --------------------------------------------------------------------------

let _flags: OstromFeatureFlags | null = null;
const _communityOverrides = new Map<string, Map<string, boolean>>();

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------

/**
 * Load feature flags from environment variables.
 *
 * AC-1.5.1: All four feature flags implemented
 * AC-1.5.2: SEQUENCE_LOCK_MODE for tier selection
 * AC-1.5.5: Values logged at startup
 *
 * @returns Loaded feature flags
 */
export function loadFeatureFlags(): OstromFeatureFlags {
  const flags: OstromFeatureFlags = {
    FEATURE_PURPOSE_TRACKING: envBool('FEATURE_PURPOSE_TRACKING', false),
    FEATURE_VELOCITY_ALERTS: envBool('FEATURE_VELOCITY_ALERTS', false),
    FEATURE_EVENT_SOURCING: envBool('FEATURE_EVENT_SOURCING', false),
    FEATURE_GOVERNANCE: envBool('FEATURE_GOVERNANCE', false),
    SEQUENCE_LOCK_MODE: envEnum(
      'SEQUENCE_LOCK_MODE',
      ['for_update', 'advisory_lock', 'range_allocation'],
      'for_update',
    ),
  };

  _flags = flags;
  return flags;
}

/**
 * Get the current feature flags (must call loadFeatureFlags() first).
 */
export function getFeatureFlags(): OstromFeatureFlags {
  if (!_flags) {
    _flags = loadFeatureFlags();
  }
  return _flags;
}

// --------------------------------------------------------------------------
// Feature Checks
// --------------------------------------------------------------------------

/**
 * Check if a feature is enabled for a community.
 *
 * Priority: community override > global flag > default (false).
 *
 * AC-1.5.3: When disabled, application code bypasses feature-specific paths
 * AC-1.5.4: DB enforcement compatible with disabled flags
 *
 * @param flag - Feature flag name
 * @param communityId - Optional community for per-community override
 * @returns Whether the feature is enabled
 */
export function isFeatureEnabled(
  flag: keyof Omit<OstromFeatureFlags, 'SEQUENCE_LOCK_MODE'>,
  communityId?: string,
): boolean {
  const flags = getFeatureFlags();

  // Check community override first
  if (communityId) {
    const overrides = _communityOverrides.get(communityId);
    if (overrides?.has(flag)) {
      return overrides.get(flag)!;
    }
  }

  // Fall back to global flag
  return flags[flag];
}

/**
 * Get the current sequence lock mode.
 *
 * @returns Current lock mode
 */
export function getSequenceLockMode(): SequenceLockMode {
  return getFeatureFlags().SEQUENCE_LOCK_MODE;
}

/**
 * Check if purpose tracking is enabled.
 * Convenience wrapper for the most commonly checked flag.
 */
export function isPurposeTrackingEnabled(communityId?: string): boolean {
  return isFeatureEnabled('FEATURE_PURPOSE_TRACKING', communityId);
}

/**
 * Check if event sourcing is enabled.
 */
export function isEventSourcingEnabled(communityId?: string): boolean {
  return isFeatureEnabled('FEATURE_EVENT_SOURCING', communityId);
}

/**
 * Check if governance is enabled.
 */
export function isGovernanceEnabled(communityId?: string): boolean {
  return isFeatureEnabled('FEATURE_GOVERNANCE', communityId);
}

/**
 * Check if velocity alerts are enabled.
 */
export function isVelocityEnabled(communityId?: string): boolean {
  return isFeatureEnabled('FEATURE_VELOCITY_ALERTS', communityId);
}

// --------------------------------------------------------------------------
// Per-Community Overrides
// --------------------------------------------------------------------------

/**
 * Set a per-community feature flag override.
 *
 * @param override - Override configuration
 */
export function setCommunityOverride(override: CommunityFlagOverride): void {
  let overrides = _communityOverrides.get(override.communityId);
  if (!overrides) {
    overrides = new Map();
    _communityOverrides.set(override.communityId, overrides);
  }
  overrides.set(override.flag, override.enabled);
}

/**
 * Remove a per-community feature flag override.
 */
export function removeCommunityOverride(
  communityId: string,
  flag: keyof Omit<OstromFeatureFlags, 'SEQUENCE_LOCK_MODE'>,
): void {
  const overrides = _communityOverrides.get(communityId);
  if (overrides) {
    overrides.delete(flag);
    if (overrides.size === 0) {
      _communityOverrides.delete(communityId);
    }
  }
}

/**
 * Get all overrides for a community.
 */
export function getCommunityOverrides(communityId: string): Map<string, boolean> {
  return _communityOverrides.get(communityId) ?? new Map();
}

/**
 * Format feature flags for startup logging.
 *
 * AC-1.5.5: Feature flag values logged at startup
 */
export function formatFlagsForLogging(): Record<string, string | boolean> {
  const flags = getFeatureFlags();
  return {
    FEATURE_PURPOSE_TRACKING: flags.FEATURE_PURPOSE_TRACKING,
    FEATURE_VELOCITY_ALERTS: flags.FEATURE_VELOCITY_ALERTS,
    FEATURE_EVENT_SOURCING: flags.FEATURE_EVENT_SOURCING,
    FEATURE_GOVERNANCE: flags.FEATURE_GOVERNANCE,
    SEQUENCE_LOCK_MODE: flags.SEQUENCE_LOCK_MODE,
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  return val === 'true' || val === '1';
}

function envEnum<T extends string>(
  key: string,
  allowed: T[],
  defaultValue: T,
): T {
  const val = process.env[key] as T | undefined;
  if (!val || !allowed.includes(val)) return defaultValue;
  return val;
}

// --------------------------------------------------------------------------
// Reset (testing only)
// --------------------------------------------------------------------------

/** Reset all flags and overrides. For testing only. */
export function _resetForTesting(): void {
  _flags = null;
  _communityOverrides.clear();
}

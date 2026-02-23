/**
 * Feature Flags Tests — Ostrom Protocol Feature Gating
 *
 * Unit tests for feature flag loading, checking, and per-community overrides.
 *
 * @see Sprint 1, Task 1.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadFeatureFlags,
  getFeatureFlags,
  isFeatureEnabled,
  isPurposeTrackingEnabled,
  isEventSourcingEnabled,
  isGovernanceEnabled,
  isVelocityEnabled,
  getSequenceLockMode,
  setCommunityOverride,
  removeCommunityOverride,
  getCommunityOverrides,
  formatFlagsForLogging,
  _resetForTesting,
} from '../feature-flags.js';

// =============================================================================
// Setup
// =============================================================================

const COMMUNITY_A = 'aaaa0000-0000-0000-0000-000000000001';
const COMMUNITY_B = 'bbbb0000-0000-0000-0000-000000000002';

beforeEach(() => {
  _resetForTesting();
  // Clear env vars
  delete process.env.FEATURE_PURPOSE_TRACKING;
  delete process.env.FEATURE_VELOCITY_ALERTS;
  delete process.env.FEATURE_EVENT_SOURCING;
  delete process.env.FEATURE_GOVERNANCE;
  delete process.env.SEQUENCE_LOCK_MODE;
});

afterEach(() => {
  _resetForTesting();
  delete process.env.FEATURE_PURPOSE_TRACKING;
  delete process.env.FEATURE_VELOCITY_ALERTS;
  delete process.env.FEATURE_EVENT_SOURCING;
  delete process.env.FEATURE_GOVERNANCE;
  delete process.env.SEQUENCE_LOCK_MODE;
});

// =============================================================================
// AC-1.5.1: All four feature flags implemented
// =============================================================================

describe('loadFeatureFlags', () => {
  it('should default all flags to false', () => {
    const flags = loadFeatureFlags();
    expect(flags.FEATURE_PURPOSE_TRACKING).toBe(false);
    expect(flags.FEATURE_VELOCITY_ALERTS).toBe(false);
    expect(flags.FEATURE_EVENT_SOURCING).toBe(false);
    expect(flags.FEATURE_GOVERNANCE).toBe(false);
  });

  it('should read true from env vars', () => {
    process.env.FEATURE_PURPOSE_TRACKING = 'true';
    process.env.FEATURE_VELOCITY_ALERTS = '1';
    process.env.FEATURE_EVENT_SOURCING = 'true';
    process.env.FEATURE_GOVERNANCE = '1';

    const flags = loadFeatureFlags();
    expect(flags.FEATURE_PURPOSE_TRACKING).toBe(true);
    expect(flags.FEATURE_VELOCITY_ALERTS).toBe(true);
    expect(flags.FEATURE_EVENT_SOURCING).toBe(true);
    expect(flags.FEATURE_GOVERNANCE).toBe(true);
  });

  it('should treat non-true/1 values as false', () => {
    process.env.FEATURE_PURPOSE_TRACKING = 'yes';
    process.env.FEATURE_VELOCITY_ALERTS = 'TRUE';
    process.env.FEATURE_EVENT_SOURCING = '0';
    process.env.FEATURE_GOVERNANCE = '';

    const flags = loadFeatureFlags();
    expect(flags.FEATURE_PURPOSE_TRACKING).toBe(false);
    expect(flags.FEATURE_VELOCITY_ALERTS).toBe(false);
    expect(flags.FEATURE_EVENT_SOURCING).toBe(false);
    expect(flags.FEATURE_GOVERNANCE).toBe(false);
  });
});

// =============================================================================
// AC-1.5.2: SEQUENCE_LOCK_MODE tier selection
// =============================================================================

describe('SEQUENCE_LOCK_MODE', () => {
  it('should default to for_update', () => {
    const flags = loadFeatureFlags();
    expect(flags.SEQUENCE_LOCK_MODE).toBe('for_update');
  });

  it('should accept advisory_lock', () => {
    process.env.SEQUENCE_LOCK_MODE = 'advisory_lock';
    const flags = loadFeatureFlags();
    expect(flags.SEQUENCE_LOCK_MODE).toBe('advisory_lock');
  });

  it('should accept range_allocation', () => {
    process.env.SEQUENCE_LOCK_MODE = 'range_allocation';
    const flags = loadFeatureFlags();
    expect(flags.SEQUENCE_LOCK_MODE).toBe('range_allocation');
  });

  it('should fall back to for_update for invalid value', () => {
    process.env.SEQUENCE_LOCK_MODE = 'invalid';
    const flags = loadFeatureFlags();
    expect(flags.SEQUENCE_LOCK_MODE).toBe('for_update');
  });

  it('should be accessible via getSequenceLockMode()', () => {
    process.env.SEQUENCE_LOCK_MODE = 'advisory_lock';
    loadFeatureFlags();
    expect(getSequenceLockMode()).toBe('advisory_lock');
  });
});

// =============================================================================
// AC-1.5.3: Feature-specific path bypass
// =============================================================================

describe('isFeatureEnabled', () => {
  it('should return false for disabled features', () => {
    loadFeatureFlags();
    expect(isFeatureEnabled('FEATURE_PURPOSE_TRACKING')).toBe(false);
    expect(isFeatureEnabled('FEATURE_EVENT_SOURCING')).toBe(false);
  });

  it('should return true for enabled features', () => {
    process.env.FEATURE_PURPOSE_TRACKING = 'true';
    loadFeatureFlags();
    expect(isFeatureEnabled('FEATURE_PURPOSE_TRACKING')).toBe(true);
  });

  it('should auto-load flags if not loaded', () => {
    process.env.FEATURE_GOVERNANCE = 'true';
    // Don't call loadFeatureFlags() — getFeatureFlags() should auto-load
    expect(isFeatureEnabled('FEATURE_GOVERNANCE')).toBe(true);
  });
});

describe('convenience wrappers', () => {
  it('isPurposeTrackingEnabled should delegate correctly', () => {
    process.env.FEATURE_PURPOSE_TRACKING = 'true';
    loadFeatureFlags();
    expect(isPurposeTrackingEnabled()).toBe(true);
  });

  it('isEventSourcingEnabled should delegate correctly', () => {
    loadFeatureFlags();
    expect(isEventSourcingEnabled()).toBe(false);
  });

  it('isGovernanceEnabled should delegate correctly', () => {
    process.env.FEATURE_GOVERNANCE = '1';
    loadFeatureFlags();
    expect(isGovernanceEnabled()).toBe(true);
  });

  it('isVelocityEnabled should delegate correctly', () => {
    loadFeatureFlags();
    expect(isVelocityEnabled()).toBe(false);
  });
});

// =============================================================================
// Per-community overrides
// =============================================================================

describe('community overrides', () => {
  beforeEach(() => {
    loadFeatureFlags();
  });

  it('should override global flag for specific community', () => {
    // Global: disabled
    expect(isFeatureEnabled('FEATURE_PURPOSE_TRACKING', COMMUNITY_A)).toBe(false);

    // Override: enabled for community A
    setCommunityOverride({
      communityId: COMMUNITY_A,
      flag: 'FEATURE_PURPOSE_TRACKING',
      enabled: true,
      reason: 'Beta testing',
    });

    expect(isFeatureEnabled('FEATURE_PURPOSE_TRACKING', COMMUNITY_A)).toBe(true);
    // Community B still uses global
    expect(isFeatureEnabled('FEATURE_PURPOSE_TRACKING', COMMUNITY_B)).toBe(false);
  });

  it('should allow disabling globally enabled flag per community', () => {
    process.env.FEATURE_GOVERNANCE = 'true';
    loadFeatureFlags();

    setCommunityOverride({
      communityId: COMMUNITY_A,
      flag: 'FEATURE_GOVERNANCE',
      enabled: false,
      reason: 'Opt-out during migration',
    });

    expect(isFeatureEnabled('FEATURE_GOVERNANCE', COMMUNITY_A)).toBe(false);
    expect(isFeatureEnabled('FEATURE_GOVERNANCE', COMMUNITY_B)).toBe(true);
  });

  it('should remove overrides correctly', () => {
    setCommunityOverride({
      communityId: COMMUNITY_A,
      flag: 'FEATURE_EVENT_SOURCING',
      enabled: true,
      reason: 'Test',
    });

    expect(isFeatureEnabled('FEATURE_EVENT_SOURCING', COMMUNITY_A)).toBe(true);

    removeCommunityOverride(COMMUNITY_A, 'FEATURE_EVENT_SOURCING');
    expect(isFeatureEnabled('FEATURE_EVENT_SOURCING', COMMUNITY_A)).toBe(false);
  });

  it('should clean up empty override maps', () => {
    setCommunityOverride({
      communityId: COMMUNITY_A,
      flag: 'FEATURE_PURPOSE_TRACKING',
      enabled: true,
      reason: 'Test',
    });

    removeCommunityOverride(COMMUNITY_A, 'FEATURE_PURPOSE_TRACKING');
    const overrides = getCommunityOverrides(COMMUNITY_A);
    expect(overrides.size).toBe(0);
  });

  it('getCommunityOverrides should return empty map for unknown community', () => {
    const overrides = getCommunityOverrides('unknown-community-id');
    expect(overrides.size).toBe(0);
  });
});

// =============================================================================
// AC-1.5.5: Values logged at startup
// =============================================================================

describe('formatFlagsForLogging', () => {
  it('should format all flags for logging', () => {
    process.env.FEATURE_PURPOSE_TRACKING = 'true';
    process.env.SEQUENCE_LOCK_MODE = 'advisory_lock';
    loadFeatureFlags();

    const logged = formatFlagsForLogging();
    expect(logged.FEATURE_PURPOSE_TRACKING).toBe(true);
    expect(logged.FEATURE_VELOCITY_ALERTS).toBe(false);
    expect(logged.FEATURE_EVENT_SOURCING).toBe(false);
    expect(logged.FEATURE_GOVERNANCE).toBe(false);
    expect(logged.SEQUENCE_LOCK_MODE).toBe('advisory_lock');
  });
});

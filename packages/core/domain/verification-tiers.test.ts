/**
 * Verification Tiers — gating-ladder invariant tests
 *
 * Target: tier -> feature gating utilities. The shadow graduation ladder reads
 * these to decide which Arrakis features a community may exercise. An off-by-one
 * in tier comparison or a break in inheritance monotonicity mis-gates access
 * (either leaks a higher-tier feature down, or fails-OPEN at a lower tier).
 *
 * High-value risk pinned: gating off-by-one + fail-closed inheritance.
 */

import { describe, it, expect } from 'vitest';
import {
  getFeaturesForTier,
  isFeatureAvailable,
  getMinimumTierForFeature,
  compareTiers,
  type VerificationTier,
  type Feature,
} from './verification-tiers.js';

const TIERS: VerificationTier[] = ['incumbent_only', 'arrakis_basic', 'arrakis_full'];

const ALL_FEATURES: Feature[] = [
  // tier 1 (incumbent_only)
  'shadow_tracking',
  'public_leaderboard_hidden_wallets',
  'admin_shadow_digest',
  // tier 2 (arrakis_basic)
  'profile_view',
  'conviction_preview',
  'position_check',
  'threshold_check',
  // tier 3 (arrakis_full)
  'full_badges',
  'tier_progression',
  'social_features',
  'profile_directory',
  'badge_showcase',
  'conviction_alerts',
  'role_management',
  'channel_gating',
];

describe('getFeaturesForTier', () => {
  it('returns exactly the tier-1 features for incumbent_only (no inheritance)', () => {
    expect(getFeaturesForTier('incumbent_only')).toEqual([
      'shadow_tracking',
      'public_leaderboard_hidden_wallets',
      'admin_shadow_digest',
    ]);
  });

  it('accumulates own + inherited features for arrakis_basic (3 + 4 = 7)', () => {
    const features = getFeaturesForTier('arrakis_basic');
    expect(features).toHaveLength(7);
    // own features first, then inherited
    expect(features).toEqual([
      'profile_view',
      'conviction_preview',
      'position_check',
      'threshold_check',
      'shadow_tracking',
      'public_leaderboard_hidden_wallets',
      'admin_shadow_digest',
    ]);
  });

  it('accumulates the full inheritance chain for arrakis_full (3 + 4 + 8 = 15)', () => {
    const features = getFeaturesForTier('arrakis_full');
    expect(features).toHaveLength(15);
    // own features come first
    expect(features[0]).toBe('full_badges');
    // then arrakis_basic features
    expect(features.slice(8, 12)).toEqual([
      'profile_view',
      'conviction_preview',
      'position_check',
      'threshold_check',
    ]);
    // then incumbent_only features at the tail
    expect(features.slice(12)).toEqual([
      'shadow_tracking',
      'public_leaderboard_hidden_wallets',
      'admin_shadow_digest',
    ]);
  });

  it('is monotone: each higher tier is a strict superset of every lower tier (fail-closed inheritance)', () => {
    const inc = new Set(getFeaturesForTier('incumbent_only'));
    const basic = new Set(getFeaturesForTier('arrakis_basic'));
    const full = new Set(getFeaturesForTier('arrakis_full'));

    for (const f of inc) expect(basic.has(f)).toBe(true);
    for (const f of basic) expect(full.has(f)).toBe(true);

    // strict: higher tiers add features
    expect(basic.size).toBeGreaterThan(inc.size);
    expect(full.size).toBeGreaterThan(basic.size);
  });

  it('never returns duplicate features (inheritance chain is a partition)', () => {
    for (const tier of TIERS) {
      const features = getFeaturesForTier(tier);
      expect(new Set(features).size).toBe(features.length);
    }
  });
});

describe('isFeatureAvailable', () => {
  it('grants inherited features at higher tiers', () => {
    expect(isFeatureAvailable('shadow_tracking', 'arrakis_full')).toBe(true);
    expect(isFeatureAvailable('profile_view', 'arrakis_full')).toBe(true);
  });

  it('grants a tier its own features', () => {
    expect(isFeatureAvailable('shadow_tracking', 'incumbent_only')).toBe(true);
    expect(isFeatureAvailable('profile_view', 'arrakis_basic')).toBe(true);
    expect(isFeatureAvailable('full_badges', 'arrakis_full')).toBe(true);
  });

  it('FAILS CLOSED: a lower tier never sees a higher tier feature (the off-by-one guard)', () => {
    // tier-3 feature must be blocked at tier-1 and tier-2
    expect(isFeatureAvailable('full_badges', 'incumbent_only')).toBe(false);
    expect(isFeatureAvailable('full_badges', 'arrakis_basic')).toBe(false);
    expect(isFeatureAvailable('channel_gating', 'arrakis_basic')).toBe(false);
    // tier-2 feature must be blocked at tier-1
    expect(isFeatureAvailable('profile_view', 'incumbent_only')).toBe(false);
    expect(isFeatureAvailable('threshold_check', 'incumbent_only')).toBe(false);
  });

  it('returns false for a feature that exists in no tier (unknown feature is denied)', () => {
    expect(isFeatureAvailable('nonexistent_feature' as Feature, 'arrakis_full')).toBe(false);
  });
});

describe('getMinimumTierForFeature', () => {
  it('resolves each feature to the lowest tier that natively defines it', () => {
    expect(getMinimumTierForFeature('shadow_tracking')).toBe('incumbent_only');
    expect(getMinimumTierForFeature('admin_shadow_digest')).toBe('incumbent_only');
    expect(getMinimumTierForFeature('profile_view')).toBe('arrakis_basic');
    expect(getMinimumTierForFeature('threshold_check')).toBe('arrakis_basic');
    expect(getMinimumTierForFeature('full_badges')).toBe('arrakis_full');
    expect(getMinimumTierForFeature('channel_gating')).toBe('arrakis_full');
  });

  it('returns null for an unknown feature', () => {
    expect(getMinimumTierForFeature('nonexistent_feature' as Feature)).toBeNull();
  });

  it('covers every declared feature (no feature is orphaned from the ladder)', () => {
    for (const f of ALL_FEATURES) {
      expect(getMinimumTierForFeature(f)).not.toBeNull();
    }
  });
});

describe('compareTiers', () => {
  it('orders incumbent_only < arrakis_basic < arrakis_full', () => {
    expect(compareTiers('incumbent_only', 'arrakis_basic')).toBeLessThan(0);
    expect(compareTiers('arrakis_basic', 'arrakis_full')).toBeLessThan(0);
    expect(compareTiers('incumbent_only', 'arrakis_full')).toBeLessThan(0);
  });

  it('is antisymmetric and zero on equality', () => {
    for (const a of TIERS) {
      expect(compareTiers(a, a)).toBe(0);
      for (const b of TIERS) {
        // antisymmetry: cmp(a,b) === -cmp(b,a), i.e. the pair sums to zero.
        // Summing avoids the signed-zero (-0 vs +0) artifact of Object.is.
        expect(compareTiers(a, b) + compareTiers(b, a)).toBe(0);
      }
    }
  });

  it('returns exact index distances (no off-by-one in the magnitude)', () => {
    expect(compareTiers('incumbent_only', 'arrakis_full')).toBe(-2);
    expect(compareTiers('arrakis_full', 'incumbent_only')).toBe(2);
    expect(compareTiers('arrakis_basic', 'incumbent_only')).toBe(1);
  });
});

describe('gating-ladder cross-function consistency (the load-bearing invariant)', () => {
  // The graduation ladder relies on these three functions agreeing. A feature is
  // available at a tier IFF that tier is at or above the feature's minimum tier.
  it('isFeatureAvailable(f, t) === (compareTiers(t, minTier(f)) >= 0) for every feature x tier', () => {
    for (const f of ALL_FEATURES) {
      const min = getMinimumTierForFeature(f);
      expect(min).not.toBeNull();
      for (const t of TIERS) {
        const available = isFeatureAvailable(f, t);
        const expected = compareTiers(t, min as VerificationTier) >= 0;
        expect(available).toBe(expected);
      }
    }
  });

  it('a community gains features only by moving UP the ladder, never loses one going up', () => {
    // For each adjacent tier step, the available set only grows.
    for (let i = 1; i < TIERS.length; i++) {
      const lower = new Set(getFeaturesForTier(TIERS[i - 1] as VerificationTier));
      const higher = new Set(getFeaturesForTier(TIERS[i] as VerificationTier));
      for (const f of lower) expect(higher.has(f)).toBe(true);
    }
  });
});
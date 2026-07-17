/**
 * FeatureGate Tests
 *
 * Sprint S-25: Shadow Sync Job & Verification Tiers
 *
 * Tests for tier-based feature access control and feature gating.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Logger } from 'pino';
import {
  FeatureGate,
  InMemoryFeatureOverrideStore,
  FeatureAccessDeniedError,
  type ICommunityTierRepository,
  type IFeatureOverrideStore,
} from './feature-gate.js';
import type { Feature, VerificationTier, FeatureOverride } from '@freeside/core/domain';

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockLogger(): Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function createMockCommunityRepo(): ICommunityTierRepository {
  return {
    getVerificationTier: vi.fn(),
  };
}

// =============================================================================
// InMemoryFeatureOverrideStore Tests
// =============================================================================

describe('InMemoryFeatureOverrideStore', () => {
  let store: InMemoryFeatureOverrideStore;

  beforeEach(() => {
    store = new InMemoryFeatureOverrideStore();
  });

  describe('saveOverride and getOverride', () => {
    it('should save and retrieve an override', async () => {
      const override: FeatureOverride = {
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Beta tester',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      };

      await store.saveOverride(override);
      const retrieved = await store.getOverride('community-123', 'profile_view');

      expect(retrieved).toEqual(override);
    });

    it('should return null for non-existent override', async () => {
      const retrieved = await store.getOverride('community-123', 'profile_view');

      expect(retrieved).toBeNull();
    });

    it('should return null for expired override', async () => {
      const override: FeatureOverride = {
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Beta tester',
        expiresAt: new Date(Date.now() - 1000), // Expired
        createdBy: 'admin',
        createdAt: new Date(),
      };

      await store.saveOverride(override);
      const retrieved = await store.getOverride('community-123', 'profile_view');

      expect(retrieved).toBeNull();
    });
  });

  describe('getOverrides', () => {
    it('should return all overrides for a community', async () => {
      await store.saveOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Reason 1',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });
      await store.saveOverride({
        communityId: 'community-123',
        feature: 'full_badges',
        action: 'deny',
        reason: 'Reason 2',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });
      await store.saveOverride({
        communityId: 'other-community',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Reason 3',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const overrides = await store.getOverrides('community-123');

      expect(overrides).toHaveLength(2);
    });

    it('should filter out expired overrides', async () => {
      await store.saveOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Active',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });
      await store.saveOverride({
        communityId: 'community-123',
        feature: 'full_badges',
        action: 'allow',
        reason: 'Expired',
        expiresAt: new Date(Date.now() - 1000),
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const overrides = await store.getOverrides('community-123');

      expect(overrides).toHaveLength(1);
      expect(overrides[0]!.feature).toBe('profile_view');
    });
  });

  describe('deleteOverride', () => {
    it('should delete an override', async () => {
      await store.saveOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Test',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const deleted = await store.deleteOverride('community-123', 'profile_view');

      expect(deleted).toBe(true);
      expect(await store.getOverride('community-123', 'profile_view')).toBeNull();
    });

    it('should return false for non-existent override', async () => {
      const deleted = await store.deleteOverride('community-123', 'profile_view');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteExpiredOverrides', () => {
    it('should delete all expired overrides', async () => {
      await store.saveOverride({
        communityId: 'community-1',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Expired 1',
        expiresAt: new Date(Date.now() - 1000),
        createdBy: 'admin',
        createdAt: new Date(),
      });
      await store.saveOverride({
        communityId: 'community-2',
        feature: 'full_badges',
        action: 'allow',
        reason: 'Expired 2',
        expiresAt: new Date(Date.now() - 2000),
        createdBy: 'admin',
        createdAt: new Date(),
      });
      await store.saveOverride({
        communityId: 'community-3',
        feature: 'shadow_tracking',
        action: 'allow',
        reason: 'Active',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const deleted = await store.deleteExpiredOverrides();

      expect(deleted).toBe(2);
      expect(await store.getOverrides('community-3')).toHaveLength(1);
    });
  });
});

// =============================================================================
// FeatureGate Tests
// =============================================================================

describe('FeatureGate', () => {
  let communities: ICommunityTierRepository;
  let overrides: IFeatureOverrideStore;
  let logger: Logger;
  let featureGate: FeatureGate;

  beforeEach(() => {
    communities = createMockCommunityRepo();
    overrides = new InMemoryFeatureOverrideStore();
    logger = createMockLogger();
    featureGate = new FeatureGate(communities, overrides, logger);
  });

  // ===========================================================================
  // Access Control Tests
  // ===========================================================================

  describe('checkAccess', () => {
    it('should allow Tier 1 features for incumbent_only tier', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      const result = await featureGate.checkAccess({
        communityId: 'community-123',
        guildId: 'guild-456',
        feature: 'shadow_tracking',
      });

      expect(result.allowed).toBe(true);
      expect(result.currentTier).toBe('incumbent_only');
    });

    it('should deny Tier 2 features for incumbent_only tier', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      const result = await featureGate.checkAccess({
        communityId: 'community-123',
        guildId: 'guild-456',
        feature: 'profile_view',
      });

      expect(result.allowed).toBe(false);
      expect(result.requiredTier).toBe('arrakis_basic');
      expect(result.denialReason).toContain('profile_view');
    });

    it('should allow all features for arrakis_full tier', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_full');

      const features: Feature[] = [
        'shadow_tracking',
        'profile_view',
        'full_badges',
        'role_management',
      ];

      for (const feature of features) {
        const result = await featureGate.checkAccess({
          communityId: 'community-123',
          guildId: 'guild-456',
          feature,
        });
        expect(result.allowed).toBe(true);
      }
    });

    it('should apply allow override regardless of tier', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      // Add override to allow a Tier 3 feature
      await overrides.saveOverride({
        communityId: 'community-123',
        feature: 'full_badges',
        action: 'allow',
        reason: 'Beta tester',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const result = await featureGate.checkAccess({
        communityId: 'community-123',
        guildId: 'guild-456',
        feature: 'full_badges',
      });

      expect(result.allowed).toBe(true);
    });

    it('should apply deny override regardless of tier', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_full');

      // Add override to deny a Tier 1 feature
      await overrides.saveOverride({
        communityId: 'community-123',
        feature: 'shadow_tracking',
        action: 'deny',
        reason: 'Suspended',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const result = await featureGate.checkAccess({
        communityId: 'community-123',
        guildId: 'guild-456',
        feature: 'shadow_tracking',
      });

      expect(result.allowed).toBe(false);
      expect(result.denialReason).toContain('Suspended');
    });

    it('should return denied for non-existent community', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue(null);

      const result = await featureGate.checkAccess({
        communityId: 'nonexistent',
        guildId: 'guild-456',
        feature: 'shadow_tracking',
      });

      expect(result.allowed).toBe(false);
      expect(result.denialReason).toContain('not found');
    });

    it('should include upgrade suggestion when denied', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      const result = await featureGate.checkAccess({
        communityId: 'community-123',
        guildId: 'guild-456',
        feature: 'profile_view',
      });

      expect(result.upgradeSuggestion).toBeDefined();
      expect(result.upgradeSuggestion).toContain('14 days');
    });
  });

  describe('checkMultiple', () => {
    it('should check multiple features efficiently', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      const results = await featureGate.checkMultiple('community-123', [
        'shadow_tracking', // Tier 1 - should be allowed
        'profile_view', // Tier 2 - should be allowed
        'full_badges', // Tier 3 - should be denied
      ]);

      expect(results.get('shadow_tracking')!.allowed).toBe(true);
      expect(results.get('profile_view')!.allowed).toBe(true);
      expect(results.get('full_badges')!.allowed).toBe(false);
    });

    it('should apply overrides in batch check', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      await overrides.saveOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Test',
        expiresAt: null,
        createdBy: 'admin',
        createdAt: new Date(),
      });

      const results = await featureGate.checkMultiple('community-123', [
        'profile_view',
        'full_badges',
      ]);

      expect(results.get('profile_view')!.allowed).toBe(true);
      expect(results.get('full_badges')!.allowed).toBe(false);
    });
  });

  describe('requireAccess', () => {
    it('should not throw when access is allowed', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_full');

      await expect(
        featureGate.requireAccess({
          communityId: 'community-123',
          guildId: 'guild-456',
          feature: 'full_badges',
        })
      ).resolves.toBeUndefined();
    });

    it('should throw FeatureAccessDeniedError when access is denied', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      await expect(
        featureGate.requireAccess({
          communityId: 'community-123',
          guildId: 'guild-456',
          feature: 'full_badges',
        })
      ).rejects.toThrow(FeatureAccessDeniedError);
    });

    it('should include correct properties in error', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      try {
        await featureGate.requireAccess({
          communityId: 'community-123',
          guildId: 'guild-456',
          feature: 'profile_view',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(FeatureAccessDeniedError);
        const e = error as FeatureAccessDeniedError;
        expect(e.feature).toBe('profile_view');
        expect(e.currentTier).toBe('incumbent_only');
        expect(e.requiredTier).toBe('arrakis_basic');
      }
    });
  });

  // ===========================================================================
  // Tier Operations Tests
  // ===========================================================================

  describe('getTier', () => {
    it('should return tier from repository', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      const tier = await featureGate.getTier('community-123');

      expect(tier).toBe('arrakis_basic');
    });

    it('should cache tier lookups', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      await featureGate.getTier('community-123');
      await featureGate.getTier('community-123');

      expect(communities.getVerificationTier).toHaveBeenCalledTimes(1);
    });

    it('should return null for non-existent community', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue(null);

      const tier = await featureGate.getTier('nonexistent');

      expect(tier).toBeNull();
    });
  });

  describe('getFeatureSet', () => {
    it('should return feature set for each tier', () => {
      const tier1 = featureGate.getFeatureSet('incumbent_only');
      const tier2 = featureGate.getFeatureSet('arrakis_basic');
      const tier3 = featureGate.getFeatureSet('arrakis_full');

      expect(tier1.features).toContain('shadow_tracking');
      expect(tier2.features).toContain('profile_view');
      expect(tier3.features).toContain('full_badges');
    });
  });

  describe('getAvailableFeatures', () => {
    it('should return all features for tier including inherited', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      const features = await featureGate.getAvailableFeatures('community-123');

      // Should have Tier 1 and Tier 2 features
      expect(features).toContain('shadow_tracking'); // Tier 1
      expect(features).toContain('profile_view'); // Tier 2
      expect(features).not.toContain('full_badges'); // Tier 3
    });

    it('should return empty array for non-existent community', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue(null);

      const features = await featureGate.getAvailableFeatures('nonexistent');

      expect(features).toEqual([]);
    });
  });

  describe('getLockedFeatures', () => {
    it('should return features not available at current tier', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      const locked = await featureGate.getLockedFeatures('community-123');

      // Tier 2 features should be locked
      expect(locked.some((f) => f.feature === 'profile_view')).toBe(true);
      // Tier 3 features should be locked
      expect(locked.some((f) => f.feature === 'full_badges')).toBe(true);
      // Tier 1 features should not be locked
      expect(locked.some((f) => f.feature === 'shadow_tracking')).toBe(false);
    });
  });

  // ===========================================================================
  // Override Management Tests
  // ===========================================================================

  describe('addOverride', () => {
    it('should add an override', async () => {
      const override = await featureGate.addOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Beta tester',
        expiresAt: null,
        createdBy: 'admin',
      });

      expect(override.createdAt).toBeDefined();
      expect(await overrides.getOverride('community-123', 'profile_view')).toEqual(override);
    });
  });

  describe('removeOverride', () => {
    it('should remove an override', async () => {
      await featureGate.addOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Beta tester',
        expiresAt: null,
        createdBy: 'admin',
      });

      const removed = await featureGate.removeOverride('community-123', 'profile_view');

      expect(removed).toBe(true);
      expect(await overrides.getOverride('community-123', 'profile_view')).toBeNull();
    });
  });

  describe('getOverrides', () => {
    it('should return all overrides for a community', async () => {
      await featureGate.addOverride({
        communityId: 'community-123',
        feature: 'profile_view',
        action: 'allow',
        reason: 'Reason 1',
        expiresAt: null,
        createdBy: 'admin',
      });
      await featureGate.addOverride({
        communityId: 'community-123',
        feature: 'full_badges',
        action: 'deny',
        reason: 'Reason 2',
        expiresAt: null,
        createdBy: 'admin',
      });

      const overridesList = await featureGate.getOverrides('community-123');

      expect(overridesList).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Middleware Tests
  // ===========================================================================

  describe('createMiddleware', () => {
    it('should call next when access is allowed', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_full');
      const next = vi.fn().mockResolvedValue(undefined);

      const middleware = featureGate.createMiddleware('full_badges');
      await middleware('community-123', 'guild-456', next);

      expect(next).toHaveBeenCalled();
    });

    it('should throw when access is denied', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('incumbent_only');
      const next = vi.fn();

      const middleware = featureGate.createMiddleware('full_badges');

      await expect(
        middleware('community-123', 'guild-456', next)
      ).rejects.toThrow(FeatureAccessDeniedError);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Cache Tests
  // ===========================================================================

  describe('cache management', () => {
    it('should invalidate cache for specific community', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      await featureGate.getTier('community-123');
      featureGate.invalidateCache('community-123');

      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_full');
      const tier = await featureGate.getTier('community-123');

      expect(tier).toBe('arrakis_full');
      expect(communities.getVerificationTier).toHaveBeenCalledTimes(2);
    });

    it('should clear all cached tiers', async () => {
      (communities.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      await featureGate.getTier('community-1');
      await featureGate.getTier('community-2');

      featureGate.clearCache();

      await featureGate.getTier('community-1');
      await featureGate.getTier('community-2');

      expect(communities.getVerificationTier).toHaveBeenCalledTimes(4);
    });
  });
});

// =============================================================================
// Verification Tier Domain Tests
// =============================================================================

describe('Verification Tiers Domain', () => {
  describe('getFeaturesForTier', () => {
    it('should return only Tier 1 features for incumbent_only', async () => {
      // Import dynamically to test
      const { getFeaturesForTier } = await import('@freeside/core/domain');

      const features = getFeaturesForTier('incumbent_only');

      expect(features).toContain('shadow_tracking');
      expect(features).toContain('public_leaderboard_hidden_wallets');
      expect(features).toContain('admin_shadow_digest');
      expect(features).not.toContain('profile_view');
    });

    it('should include inherited features for arrakis_basic', async () => {
      const { getFeaturesForTier } = await import('@freeside/core/domain');

      const features = getFeaturesForTier('arrakis_basic');

      // Tier 2 features
      expect(features).toContain('profile_view');
      expect(features).toContain('conviction_preview');
      // Inherited Tier 1 features
      expect(features).toContain('shadow_tracking');
    });

    it('should include all features for arrakis_full', async () => {
      const { getFeaturesForTier } = await import('@freeside/core/domain');

      const features = getFeaturesForTier('arrakis_full');

      // Tier 3 features
      expect(features).toContain('full_badges');
      expect(features).toContain('role_management');
      // Inherited Tier 2 features
      expect(features).toContain('profile_view');
      // Inherited Tier 1 features
      expect(features).toContain('shadow_tracking');
    });
  });

  describe('isFeatureAvailable', () => {
    it('should correctly check feature availability', async () => {
      const { isFeatureAvailable } = await import('@freeside/core/domain');

      expect(isFeatureAvailable('shadow_tracking', 'incumbent_only')).toBe(true);
      expect(isFeatureAvailable('profile_view', 'incumbent_only')).toBe(false);
      expect(isFeatureAvailable('profile_view', 'arrakis_basic')).toBe(true);
      expect(isFeatureAvailable('full_badges', 'arrakis_basic')).toBe(false);
      expect(isFeatureAvailable('full_badges', 'arrakis_full')).toBe(true);
    });
  });

  describe('getMinimumTierForFeature', () => {
    it('should return correct minimum tier', async () => {
      const { getMinimumTierForFeature } = await import('@freeside/core/domain');

      expect(getMinimumTierForFeature('shadow_tracking')).toBe('incumbent_only');
      expect(getMinimumTierForFeature('profile_view')).toBe('arrakis_basic');
      expect(getMinimumTierForFeature('full_badges')).toBe('arrakis_full');
    });
  });

  describe('compareTiers', () => {
    it('should correctly compare tiers', async () => {
      const { compareTiers } = await import('@freeside/core/domain');

      expect(compareTiers('incumbent_only', 'arrakis_basic')).toBeLessThan(0);
      expect(compareTiers('arrakis_full', 'arrakis_basic')).toBeGreaterThan(0);
      expect(compareTiers('arrakis_basic', 'arrakis_basic')).toBe(0);
    });
  });
});

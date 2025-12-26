/**
 * Gatekeeper Service Tests (v4.0 - Sprint 25)
 *
 * Tests for the GatekeeperService including:
 * - Feature access checks
 * - Tier lookup
 * - Cache behavior (Redis hit/miss)
 * - Fallback behavior when Redis unavailable
 * - Grace period handling
 * - Waiver priority over subscription
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// =============================================================================
// Mock Setup - MUST be before imports
// =============================================================================

vi.mock('../../../src/config.js', () => ({
  config: {
    stripe: {
      upgradeUrl: 'https://sietch.io/upgrade',
    },
    featureFlags: {
      gatekeeperEnabled: true,
    },
  },
}));

vi.mock('../../../src/services/cache/RedisService.js', () => ({
  redisService: {
    getEntitlements: vi.fn(),
    setEntitlements: vi.fn(),
    invalidateEntitlements: vi.fn(),
  },
}));

vi.mock('../../../src/db/billing-queries.js', () => ({
  getActiveFeeWaiver: vi.fn(),
  getSubscriptionByCommunityId: vi.fn(),
  getEffectiveTier: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { gatekeeperService } from '../../../src/services/billing/GatekeeperService.js';
import { redisService } from '../../../src/services/cache/RedisService.js';
import * as billingQueries from '../../../src/db/billing-queries.js';
import type {
  Subscription,
  FeeWaiver,
  Entitlements,
  Feature,
} from '../../../src/types/billing.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockSubscription(
  overrides: Partial<Subscription> = {}
): Subscription {
  return {
    id: 'sub-123',
    communityId: 'comm-123',
    stripeCustomerId: 'cus-123',
    stripeSubscriptionId: 'sub-stripe-123',
    tier: 'premium',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockWaiver(overrides: Partial<FeeWaiver> = {}): FeeWaiver {
  return {
    id: 'waiver-123',
    communityId: 'comm-123',
    tier: 'enterprise',
    reason: 'Beta partner',
    grantedBy: 'admin-123',
    grantedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockEntitlements(
  overrides: Partial<Entitlements> = {}
): Entitlements {
  const now = new Date();
  return {
    communityId: 'comm-123',
    tier: 'premium',
    maxMembers: 1000,
    features: [
      'discord_bot',
      'basic_onboarding',
      'member_profiles',
      'stats_leaderboard',
      'position_alerts',
      'custom_nym',
      'nine_tier_system',
      'custom_pfp',
      'weekly_digest',
      'activity_tracking',
      'score_badge',
    ] as Feature[],
    source: 'subscription',
    inGracePeriod: false,
    cachedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('GatekeeperService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkAccess', () => {
    it('should allow access when tier satisfies requirement', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'premium',
        features: ['nine_tier_system'] as Feature[],
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.checkAccess({
        communityId: 'comm-123',
        feature: 'nine_tier_system',
      });

      expect(result.canAccess).toBe(true);
      expect(result.tier).toBe('premium');
      expect(result.requiredTier).toBe('premium');
      expect(result.inGracePeriod).toBe(false);
      expect(result.upgradeUrl).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it('should deny access when tier does not satisfy requirement', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'starter',
        features: ['discord_bot'] as Feature[],
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.checkAccess({
        communityId: 'comm-123',
        feature: 'admin_analytics',
      });

      expect(result.canAccess).toBe(false);
      expect(result.tier).toBe('starter');
      expect(result.requiredTier).toBe('exclusive');
      expect(result.upgradeUrl).toBeDefined();
      expect(result.reason).toContain('requires Exclusive tier');
    });

    it('should respect grace period in result', async () => {
      const graceUntil = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
      const mockEntitlements = createMockEntitlements({
        tier: 'premium',
        inGracePeriod: true,
        graceUntil,
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.checkAccess({
        communityId: 'comm-123',
        feature: 'nine_tier_system',
      });

      expect(result.canAccess).toBe(true);
      expect(result.inGracePeriod).toBe(true);
    });

    it('should allow starter tier features for all tiers', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'starter',
        features: ['discord_bot', 'basic_onboarding'] as Feature[],
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.checkAccess({
        communityId: 'comm-123',
        feature: 'discord_bot',
      });

      expect(result.canAccess).toBe(true);
    });

    it('should allow enterprise tier to access all features', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'enterprise',
        features: [
          'white_label',
          'dedicated_support',
          'custom_integrations',
        ] as Feature[],
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.checkAccess({
        communityId: 'comm-123',
        feature: 'white_label',
      });

      expect(result.canAccess).toBe(true);
    });
  });

  describe('checkMultipleAccess', () => {
    it('should check multiple features efficiently', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'premium',
        features: [
          'nine_tier_system',
          'stats_leaderboard',
          'discord_bot',
        ] as Feature[],
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const features: Feature[] = [
        'nine_tier_system',
        'admin_analytics',
        'discord_bot',
      ];
      const results = await gatekeeperService.checkMultipleAccess(
        'comm-123',
        features
      );

      expect(results.size).toBe(3);
      expect(results.get('nine_tier_system')?.canAccess).toBe(true);
      expect(results.get('admin_analytics')?.canAccess).toBe(false);
      expect(results.get('discord_bot')?.canAccess).toBe(true);

      // Should only call getEntitlements once (efficient)
      expect(redisService.getEntitlements).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentTier', () => {
    it('should return tier information', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'premium',
        source: 'subscription',
      });

      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.getCurrentTier({
        communityId: 'comm-123',
      });

      expect(result.tier).toBe('premium');
      expect(result.name).toBe('Premium');
      expect(result.price).toBe(99);
      expect(result.maxMembers).toBe(1000);
      expect(result.source).toBe('subscription');
      expect(result.inGracePeriod).toBe(false);
    });
  });

  describe('getEntitlements - Cache behavior', () => {
    it('should return cached entitlements on cache hit', async () => {
      const mockEntitlements = createMockEntitlements();
      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result).toEqual(mockEntitlements);
      expect(redisService.getEntitlements).toHaveBeenCalledWith('comm-123');
      expect(redisService.setEntitlements).not.toHaveBeenCalled();
      // Database should not be queried on cache hit
      expect(billingQueries.getActiveFeeWaiver).not.toHaveBeenCalled();
    });

    it('should lookup from database and cache on cache miss', async () => {
      // Cache miss
      vi.mocked(redisService.getEntitlements).mockResolvedValue(null);

      // Database has active subscription
      const mockSubscription = createMockSubscription({
        tier: 'premium',
        status: 'active',
      });
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('premium');
      expect(result.source).toBe('subscription');
      expect(result.features).toContain('nine_tier_system');

      // Should have cached the result
      expect(redisService.setEntitlements).toHaveBeenCalledWith(
        'comm-123',
        expect.objectContaining({ tier: 'premium' })
      );
    });

    it('should fall back to database when Redis unavailable', async () => {
      // Redis throws error
      vi.mocked(redisService.getEntitlements).mockRejectedValue(
        new Error('Redis connection failed')
      );

      // Database has subscription
      const mockSubscription = createMockSubscription({
        tier: 'basic',
        status: 'active',
      });
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('basic');
      expect(result.source).toBe('subscription');
    });
  });

  describe('getEntitlements - Lookup priority', () => {
    beforeEach(() => {
      // Cache miss for all tests
      vi.mocked(redisService.getEntitlements).mockResolvedValue(null);
    });

    it('should prioritize active waiver over subscription', async () => {
      const mockWaiver = createMockWaiver({ tier: 'enterprise' });
      const mockSubscription = createMockSubscription({ tier: 'basic' });

      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('enterprise');
      expect(result.source).toBe('waiver');
    });

    it('should use subscription when no waiver exists', async () => {
      const mockSubscription = createMockSubscription({
        tier: 'premium',
        status: 'active',
      });

      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('premium');
      expect(result.source).toBe('subscription');
    });

    it('should handle subscription in grace period', async () => {
      const graceUntil = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const mockSubscription = createMockSubscription({
        tier: 'exclusive',
        status: 'past_due',
        graceUntil,
      });

      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('exclusive');
      expect(result.source).toBe('subscription');
      expect(result.inGracePeriod).toBe(true);
      expect(result.graceUntil).toEqual(graceUntil);
    });

    it('should not use subscription with expired grace period', async () => {
      const expiredGrace = new Date(Date.now() - 1000);
      const mockSubscription = createMockSubscription({
        tier: 'premium',
        status: 'past_due',
        graceUntil: expiredGrace,
      });

      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      // Should fall back to free tier
      expect(result.tier).toBe('starter');
      expect(result.source).toBe('free');
      expect(result.inGracePeriod).toBe(false);
    });

    it('should default to starter tier when no subscription or waiver', async () => {
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(null);

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('starter');
      expect(result.source).toBe('free');
      expect(result.maxMembers).toBe(100);
    });

    it('should not use canceled subscription', async () => {
      const mockSubscription = createMockSubscription({
        tier: 'premium',
        status: 'canceled',
      });

      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
      vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
        mockSubscription
      );

      const result = await gatekeeperService.getEntitlements('comm-123');

      expect(result.tier).toBe('starter');
      expect(result.source).toBe('free');
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate entitlements in Redis', async () => {
      await gatekeeperService.invalidateCache('comm-123');

      expect(redisService.invalidateEntitlements).toHaveBeenCalledWith('comm-123');
    });

    it('should handle Redis errors gracefully', async () => {
      vi.mocked(redisService.invalidateEntitlements).mockRejectedValue(
        new Error('Redis error')
      );

      // Should not throw
      await expect(
        gatekeeperService.invalidateCache('comm-123')
      ).resolves.toBeUndefined();
    });
  });

  describe('Convenience methods', () => {
    beforeEach(() => {
      const mockEntitlements = createMockEntitlements({
        tier: 'premium',
        maxMembers: 1000,
        features: ['nine_tier_system', 'stats_leaderboard'] as Feature[],
      });
      vi.mocked(redisService.getEntitlements).mockResolvedValue(mockEntitlements);
    });

    it('canAddMembers should check member limit', async () => {
      const canAdd900 = await gatekeeperService.canAddMembers('comm-123', 900);
      expect(canAdd900).toBe(true);

      const canAdd1000 = await gatekeeperService.canAddMembers('comm-123', 1000);
      expect(canAdd1000).toBe(false);
    });

    it('getMemberLimit should return max members', async () => {
      const limit = await gatekeeperService.getMemberLimit('comm-123');
      expect(limit).toBe(1000);
    });

    it('isInGracePeriod should return grace period status', async () => {
      const inGrace = await gatekeeperService.isInGracePeriod('comm-123');
      expect(inGrace).toBe(false);
    });

    it('getAvailableFeatures should return feature list', async () => {
      const features = await gatekeeperService.getAvailableFeatures('comm-123');
      expect(features).toContain('nine_tier_system');
      expect(features).toContain('stats_leaderboard');
    });
  });

  describe('Member limits by tier', () => {
    beforeEach(() => {
      vi.mocked(redisService.getEntitlements).mockResolvedValue(null);
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
    });

    it('should return correct member limits for each tier', async () => {
      const tiers: Array<[string, number]> = [
        ['starter', 100],
        ['basic', 500],
        ['premium', 1000],
        ['exclusive', 2500],
        ['elite', 10000],
        ['enterprise', Infinity],
      ];

      for (const [tier, expectedLimit] of tiers) {
        const mockSubscription = createMockSubscription({
          tier: tier as any,
          status: 'active',
        });
        vi.mocked(billingQueries.getSubscriptionByCommunityId).mockReturnValue(
          mockSubscription
        );

        const entitlements = await gatekeeperService.getEntitlements('comm-123');
        expect(entitlements.maxMembers).toBe(expectedLimit);
      }
    });
  });
});

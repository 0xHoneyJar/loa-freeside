/**
 * Boost Service Tests (v4.0 - Sprint 28)
 *
 * Test suite for BoostService covering:
 * - Boost level calculation
 * - Community boost status
 * - Perk retrieval
 * - Booster information
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

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/services/billing/StripeService.js', () => ({
  stripeService: {
    getOrCreateCustomer: vi.fn(),
    createOneTimeCheckoutSession: vi.fn(),
  },
}));

vi.mock('../../../src/services/billing/GatekeeperService.js', () => ({
  gatekeeperService: {
    invalidateCache: vi.fn(),
  },
}));

vi.mock('../../../src/db/boost-queries.js', () => ({
  getCommunityBoostLevel: vi.fn(),
  getActiveBoosterCount: vi.fn(),
  calculateBoostLevel: vi.fn(),
  calculateProgressToNextLevel: vi.fn(),
  getMemberActiveBoost: vi.fn(),
  getMemberBoosterInfo: vi.fn(),
  createBoostPurchase: vi.fn(),
  extendMemberBoost: vi.fn(),
  updateCommunityBoostStats: vi.fn(),
  isMemberBoosting: vi.fn(),
  getCommunityBoosters: vi.fn(),
  getTopBoosters: vi.fn(),
  getCommunityBoostStats: vi.fn(),
  getBoostPurchaseById: vi.fn(),
  getBoostPurchaseByStripeId: vi.fn(),
  deactivateExpiredBoosts: vi.fn(),
  getBoostPurchaseStats: vi.fn(),
}));

vi.mock('../../../src/db/migrations/011_boosts.js', () => ({
  DEFAULT_BOOST_THRESHOLDS: {
    level1: 2,
    level2: 7,
    level3: 15,
  },
  DEFAULT_BOOST_PRICING: {
    pricePerMonthCents: 499,
    bundles: [
      { months: 1, priceCents: 499, stripePriceId: 'price_1mo', label: '1 Month', discount: 0 },
      { months: 3, priceCents: 1347, stripePriceId: 'price_3mo', label: '3 Months', discount: 10 },
      { months: 6, priceCents: 2395, stripePriceId: 'price_6mo', label: '6 Months', discount: 20 },
      { months: 12, priceCents: 4192, stripePriceId: 'price_12mo', label: '12 Months', discount: 30 },
    ],
  },
}));

// =============================================================================
// Imports - AFTER mocks
// =============================================================================

import { boostService, BOOST_PERKS } from '../../../src/services/boost/BoostService.js';
import * as boostQueries from '../../../src/db/boost-queries.js';

describe('BoostService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Boost Level Calculation
  // ---------------------------------------------------------------------------

  describe('getBoostLevel', () => {
    it('should return level 0 for no boosters', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(0);

      const level = boostService.getBoostLevel('test-community');

      expect(level).toBe(0);
    });

    it('should return level 1 for 2+ boosters', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(1);

      const level = boostService.getBoostLevel('test-community');

      expect(level).toBe(1);
    });

    it('should return level 2 for 7+ boosters', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(2);

      const level = boostService.getBoostLevel('test-community');

      expect(level).toBe(2);
    });

    it('should return level 3 for 15+ boosters', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(3);

      const level = boostService.getBoostLevel('test-community');

      expect(level).toBe(3);
    });
  });

  describe('hasBoostLevel', () => {
    it('should return true when current level meets minimum', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(2);

      expect(boostService.hasBoostLevel('test-community', 1)).toBe(true);
      expect(boostService.hasBoostLevel('test-community', 2)).toBe(true);
    });

    it('should return false when current level is below minimum', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(1);

      expect(boostService.hasBoostLevel('test-community', 2)).toBe(false);
      expect(boostService.hasBoostLevel('test-community', 3)).toBe(false);
    });

    it('should return false when no boosters', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(0);

      expect(boostService.hasBoostLevel('test-community', 1)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Community Boost Status
  // ---------------------------------------------------------------------------

  describe('getCommunityBoostStatus', () => {
    it('should return status for unboosted community', () => {
      vi.mocked(boostQueries.updateCommunityBoostStats).mockImplementation(() => {});
      vi.mocked(boostQueries.getCommunityBoostStats).mockReturnValue({
        communityId: 'test-community',
        totalBoosters: 0,
        totalBoostMonths: 0,
        currentLevel: 0,
        updatedAt: new Date(),
      });
      vi.mocked(boostQueries.getActiveBoosterCount).mockReturnValue(0);
      vi.mocked(boostQueries.calculateBoostLevel).mockReturnValue(0);
      vi.mocked(boostQueries.calculateProgressToNextLevel).mockReturnValue({
        currentLevel: 0,
        progressPercent: 0,
        boostersNeeded: 2,
        nextLevel: 1,
      });

      const status = boostService.getCommunityBoostStatus('test-community');

      expect(status.level).toBe(0);
      expect(status.totalBoosters).toBe(0);
    });

    it('should return status for level 1 community', () => {
      vi.mocked(boostQueries.updateCommunityBoostStats).mockImplementation(() => {});
      vi.mocked(boostQueries.getCommunityBoostStats).mockReturnValue({
        communityId: 'test-community',
        totalBoosters: 4,
        totalBoostMonths: 8,
        currentLevel: 1,
        updatedAt: new Date(),
      });
      vi.mocked(boostQueries.getActiveBoosterCount).mockReturnValue(4);
      vi.mocked(boostQueries.calculateBoostLevel).mockReturnValue(1);
      vi.mocked(boostQueries.calculateProgressToNextLevel).mockReturnValue({
        currentLevel: 1,
        progressPercent: 57,
        boostersNeeded: 3,
        nextLevel: 2,
      });

      const status = boostService.getCommunityBoostStatus('test-community');

      expect(status.level).toBe(1);
      expect(status.totalBoosters).toBe(4);
      expect(status.progressToNextLevel).toBe(57);
    });
  });

  // ---------------------------------------------------------------------------
  // Perks
  // ---------------------------------------------------------------------------

  describe('getPerksForLevel', () => {
    it('should return empty array for level 0', () => {
      const perks = boostService.getPerksForLevel(0);
      expect(perks).toHaveLength(0);
    });

    it('should return level 1 perks', () => {
      const perks = boostService.getPerksForLevel(1);
      expect(perks.length).toBeGreaterThan(0);
      expect(perks.every(p => p.minLevel <= 1)).toBe(true);
    });

    it('should return level 1 and 2 perks for level 2', () => {
      const perks = boostService.getPerksForLevel(2);
      const level1Perks = BOOST_PERKS.filter(p => p.minLevel === 1);
      const level2Perks = BOOST_PERKS.filter(p => p.minLevel === 2);

      expect(perks.length).toBe(level1Perks.length + level2Perks.length);
    });

    it('should return all perks for level 3', () => {
      const perks = boostService.getPerksForLevel(3);
      expect(perks.length).toBe(BOOST_PERKS.length);
    });
  });

  describe('isPerkUnlocked', () => {
    it('should return false for level 0 community', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(0);

      const result = boostService.isPerkUnlocked('custom_emojis', 'test-community');

      expect(result).toBe(false);
    });

    it('should return true for unlocked perk', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(1);

      const result = boostService.isPerkUnlocked('custom_emojis', 'test-community');

      expect(result).toBe(true);
    });

    it('should return false for locked perk', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(1);

      const result = boostService.isPerkUnlocked('vanity_url', 'test-community');

      expect(result).toBe(false); // Level 3 perk
    });

    it('should return false for unknown perk', () => {
      vi.mocked(boostQueries.getCommunityBoostLevel).mockReturnValue(3);

      const result = boostService.isPerkUnlocked('nonexistent_perk', 'test-community');

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Booster Information
  // ---------------------------------------------------------------------------

  describe('getBoosters', () => {
    it('should return boosters for community', () => {
      const mockBoosters = [
        {
          memberId: 'member-1',
          nym: 'Booster1',
          isActive: true,
          totalMonthsBoosted: 6,
          firstBoostDate: new Date(),
          currentBoostExpiry: new Date(),
        },
      ];

      vi.mocked(boostQueries.getCommunityBoosters).mockReturnValue(mockBoosters);

      const boosters = boostService.getBoosters('test-community');

      expect(boosters).toHaveLength(1);
      expect(boosters[0].nym).toBe('Booster1');
    });

    it('should return empty array when no boosters', () => {
      vi.mocked(boostQueries.getCommunityBoosters).mockReturnValue([]);

      const boosters = boostService.getBoosters('test-community');

      expect(boosters).toHaveLength(0);
    });
  });

  describe('getTopBoosters', () => {
    it('should return top boosters', () => {
      const mockBoosters = [
        {
          memberId: 'member-1',
          nym: 'TopBooster',
          isActive: true,
          totalMonthsBoosted: 12,
          firstBoostDate: new Date(),
          currentBoostExpiry: new Date(),
        },
        {
          memberId: 'member-2',
          nym: 'SecondBooster',
          isActive: true,
          totalMonthsBoosted: 6,
          firstBoostDate: new Date(),
          currentBoostExpiry: new Date(),
        },
      ];

      vi.mocked(boostQueries.getTopBoosters).mockReturnValue(mockBoosters);

      const topBoosters = boostService.getTopBoosters('test-community', 5);

      expect(topBoosters).toHaveLength(2);
      expect(topBoosters[0].totalMonthsBoosted).toBe(12);
    });

    it('should return empty array when no boosters', () => {
      vi.mocked(boostQueries.getTopBoosters).mockReturnValue([]);

      const topBoosters = boostService.getTopBoosters('test-community', 5);

      expect(topBoosters).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Member Boost Info
  // ---------------------------------------------------------------------------

  describe('getMemberBoost', () => {
    it('should return null for non-booster', () => {
      vi.mocked(boostQueries.getMemberActiveBoost).mockReturnValue(null);

      const boost = boostService.getMemberBoost('test-member', 'test-community');

      expect(boost).toBeNull();
    });

    it('should return active boost for booster', () => {
      const mockBoost = {
        id: 'boost-123',
        memberId: 'test-member',
        communityId: 'test-community',
        monthsPurchased: 3,
        amountPaidCents: 1347,
        purchasedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        isActive: true,
        createdAt: new Date(),
      };

      vi.mocked(boostQueries.getMemberActiveBoost).mockReturnValue(mockBoost);

      const boost = boostService.getMemberBoost('test-member', 'test-community');

      expect(boost).not.toBeNull();
      expect(boost?.monthsPurchased).toBe(3);
    });
  });

  describe('getBoosterInfo', () => {
    it('should return null for non-booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const info = boostService.getBoosterInfo('test-member', 'test-community');

      expect(info).toBeNull();
    });

    it('should return booster info for active booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 3,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });

      const info = boostService.getBoosterInfo('test-member', 'test-community');

      expect(info).not.toBeNull();
      expect(info?.totalMonthsBoosted).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Free Boost Grant
  // ---------------------------------------------------------------------------

  describe('grantFreeBoost', () => {
    it('should grant boost to member', () => {
      const mockPurchase = {
        id: 'granted-boost',
        memberId: 'test-member',
        communityId: 'test-community',
        monthsPurchased: 1,
        amountPaidCents: 0,
        purchasedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
        createdAt: new Date(),
      };

      vi.mocked(boostQueries.createBoostPurchase).mockReturnValue('granted-boost');
      vi.mocked(boostQueries.getBoostPurchaseById).mockReturnValue(mockPurchase);

      const purchase = boostService.grantFreeBoost(
        'test-member',
        'test-community',
        1,
        'admin-user'
      );

      expect(purchase.id).toBe('granted-boost');
      expect(purchase.amountPaidCents).toBe(0);
      expect(boostQueries.createBoostPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'test-member',
          communityId: 'test-community',
          monthsPurchased: 1,
          amountPaidCents: 0,
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // BOOST_PERKS export
  // ---------------------------------------------------------------------------

  describe('BOOST_PERKS', () => {
    it('should export perks array', () => {
      expect(BOOST_PERKS).toBeDefined();
      expect(Array.isArray(BOOST_PERKS)).toBe(true);
    });

    it('should have 9 perks across 3 levels', () => {
      expect(BOOST_PERKS.length).toBe(9);

      const level1Perks = BOOST_PERKS.filter(p => p.minLevel === 1);
      const level2Perks = BOOST_PERKS.filter(p => p.minLevel === 2);
      const level3Perks = BOOST_PERKS.filter(p => p.minLevel === 3);

      expect(level1Perks.length).toBe(3);
      expect(level2Perks.length).toBe(3);
      expect(level3Perks.length).toBe(3);
    });

    it('should have both community and booster scoped perks', () => {
      const communityPerks = BOOST_PERKS.filter(p => p.scope === 'community');
      const boosterPerks = BOOST_PERKS.filter(p => p.scope === 'booster');

      expect(communityPerks.length).toBeGreaterThan(0);
      expect(boosterPerks.length).toBeGreaterThan(0);
    });
  });
});

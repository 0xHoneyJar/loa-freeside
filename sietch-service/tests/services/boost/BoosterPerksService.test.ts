/**
 * Booster Perks Service Tests (v4.0 - Sprint 28)
 *
 * Test suite for BoosterPerksService covering:
 * - Booster badge display
 * - Booster tier calculation
 * - Recognition formatting
 * - Leaderboard generation
 * - Perk eligibility
 * - Discord integration helpers
 * - Anniversary and milestone tracking
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

vi.mock('../../../src/db/boost-queries.js', () => ({
  getMemberBoosterInfo: vi.fn(),
  getCommunityBoosters: vi.fn(),
  isMemberBoosting: vi.fn(),
  getCommunityBoostLevel: vi.fn(),
}));

vi.mock('../../../src/services/boost/BoostService.js', () => ({
  boostService: {
    hasBoostLevel: vi.fn(),
    getBoostLevel: vi.fn(),
  },
  BOOST_PERKS: [
    { id: 'custom_emojis', name: 'Custom Emojis', minLevel: 1, scope: 'community' },
    { id: 'booster_badge', name: 'Booster Badge', minLevel: 1, scope: 'booster' },
    { id: 'booster_role', name: 'Booster Role', minLevel: 1, scope: 'booster' },
    { id: 'animated_banner', name: 'Animated Banner', minLevel: 2, scope: 'community' },
    { id: 'priority_support', name: 'Priority Support', minLevel: 2, scope: 'booster' },
    { id: 'early_access', name: 'Early Access', minLevel: 2, scope: 'booster' },
    { id: 'vanity_url', name: 'Vanity URL', minLevel: 3, scope: 'community' },
    { id: 'custom_invite', name: 'Custom Invite', minLevel: 3, scope: 'community' },
    { id: 'exclusive_channel', name: 'Exclusive Channel', minLevel: 3, scope: 'booster' },
  ],
}));

// =============================================================================
// Imports - AFTER mocks
// =============================================================================

import { boosterPerksService, BOOSTER_TIERS } from '../../../src/services/boost/BoosterPerksService.js';
import * as boostQueries from '../../../src/db/boost-queries.js';
import { boostService } from '../../../src/services/boost/BoostService.js';

describe('BoosterPerksService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Booster Tier Calculation
  // ---------------------------------------------------------------------------

  describe('getBoosterTier', () => {
    it('should return "new" for 0-2 months', () => {
      expect(boosterPerksService.getBoosterTier(0)).toBe('new');
      expect(boosterPerksService.getBoosterTier(1)).toBe('new');
      expect(boosterPerksService.getBoosterTier(2)).toBe('new');
    });

    it('should return "supporter" for 3-5 months', () => {
      expect(boosterPerksService.getBoosterTier(3)).toBe('supporter');
      expect(boosterPerksService.getBoosterTier(4)).toBe('supporter');
      expect(boosterPerksService.getBoosterTier(5)).toBe('supporter');
    });

    it('should return "champion" for 6-11 months', () => {
      expect(boosterPerksService.getBoosterTier(6)).toBe('champion');
      expect(boosterPerksService.getBoosterTier(9)).toBe('champion');
      expect(boosterPerksService.getBoosterTier(11)).toBe('champion');
    });

    it('should return "legend" for 12+ months', () => {
      expect(boosterPerksService.getBoosterTier(12)).toBe('legend');
      expect(boosterPerksService.getBoosterTier(24)).toBe('legend');
      expect(boosterPerksService.getBoosterTier(100)).toBe('legend');
    });
  });

  // ---------------------------------------------------------------------------
  // Booster Badge Display
  // ---------------------------------------------------------------------------

  describe('getBoosterBadge', () => {
    it('should return empty string for non-booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community');

      expect(badge).toBe('');
    });

    it('should return empty string for inactive booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: false,
        totalMonthsBoosted: 5,
        firstBoostDate: new Date(),
        currentBoostExpiry: null,
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community');

      expect(badge).toBe('');
    });

    it('should return tier emoji for new booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 1,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community');

      expect(badge).toBe(BOOSTER_TIERS.new.emoji); // '🚀'
    });

    it('should return supporter emoji', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 4,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community');

      expect(badge).toBe(BOOSTER_TIERS.supporter.emoji); // '⭐'
    });

    it('should return champion emoji', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 8,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community');

      expect(badge).toBe(BOOSTER_TIERS.champion.emoji); // '🏆'
    });

    it('should return legend emoji', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 15,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community');

      expect(badge).toBe(BOOSTER_TIERS.legend.emoji); // '👑'
    });

    it('should include months count when option enabled', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 6,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community', {
        showMonths: true,
      });

      expect(badge).toContain('6mo');
    });

    it('should use custom emoji when provided', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 1,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const badge = boosterPerksService.getBoosterBadge('test-member', 'test-community', {
        customEmoji: '💎',
      });

      expect(badge).toBe('💎');
    });
  });

  // ---------------------------------------------------------------------------
  // Booster Recognition
  // ---------------------------------------------------------------------------

  describe('getBoosterRecognition', () => {
    it('should return non-booster recognition', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const recognition = boosterPerksService.getBoosterRecognition('test-member', 'test-community');

      expect(recognition.isBooster).toBe(false);
      expect(recognition.badgeEmoji).toBe('');
      expect(recognition.totalMonths).toBe(0);
    });

    it('should return full recognition for active booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 7,
        firstBoostDate: new Date(Date.now() - 7 * 30 * 24 * 60 * 60 * 1000),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const recognition = boosterPerksService.getBoosterRecognition('test-member', 'test-community');

      expect(recognition.isBooster).toBe(true);
      expect(recognition.badgeEmoji).toBe(BOOSTER_TIERS.champion.emoji);
      expect(recognition.boosterTier).toBe('champion');
      expect(recognition.roleColor).toBe(BOOSTER_TIERS.champion.color);
      expect(recognition.totalMonths).toBe(7);
    });

    it('should include display string', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 3,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const recognition = boosterPerksService.getBoosterRecognition('test-member', 'test-community');

      expect(recognition.displayString).toContain('Supporter');
      expect(recognition.displayString).toContain('3 months');
    });
  });

  // ---------------------------------------------------------------------------
  // Booster Leaderboard
  // ---------------------------------------------------------------------------

  describe('getBoosterLeaderboard', () => {
    it('should return ranked leaderboard', () => {
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

      vi.mocked(boostQueries.getCommunityBoosters).mockReturnValue(mockBoosters);

      const leaderboard = boosterPerksService.getBoosterLeaderboard('test-community');

      expect(leaderboard).toHaveLength(2);
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].tier).toBe('legend');
      expect(leaderboard[1].rank).toBe(2);
      expect(leaderboard[1].tier).toBe('champion');
    });

    it('should respect limit parameter', () => {
      const mockBoosters = Array.from({ length: 20 }, (_, i) => ({
        memberId: `member-${i}`,
        nym: `Booster${i}`,
        isActive: true,
        totalMonthsBoosted: 20 - i,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(),
      }));

      vi.mocked(boostQueries.getCommunityBoosters).mockReturnValue(mockBoosters.slice(0, 5));

      const leaderboard = boosterPerksService.getBoosterLeaderboard('test-community', 5);

      expect(leaderboard).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Perk Eligibility
  // ---------------------------------------------------------------------------

  describe('hasBoosterPerk', () => {
    it('should return false for unknown perk', () => {
      const result = boosterPerksService.hasBoosterPerk('test-member', 'test-community', 'unknown_perk');

      expect(result).toBe(false);
    });

    it('should return true for community perk when level is met', () => {
      vi.mocked(boostService.hasBoostLevel).mockReturnValue(true);

      const result = boosterPerksService.hasBoosterPerk('test-member', 'test-community', 'custom_emojis');

      expect(result).toBe(true);
    });

    it('should return false for booster-only perk when not boosting', () => {
      vi.mocked(boostService.hasBoostLevel).mockReturnValue(true);
      vi.mocked(boostQueries.isMemberBoosting).mockReturnValue(false);

      const result = boosterPerksService.hasBoosterPerk('test-member', 'test-community', 'booster_badge');

      expect(result).toBe(false);
    });

    it('should return true for booster-only perk when boosting', () => {
      vi.mocked(boostService.hasBoostLevel).mockReturnValue(true);
      vi.mocked(boostQueries.isMemberBoosting).mockReturnValue(true);

      const result = boosterPerksService.hasBoosterPerk('test-member', 'test-community', 'booster_badge');

      expect(result).toBe(true);
    });
  });

  describe('getMemberPerks', () => {
    it('should categorize perks correctly for non-booster', () => {
      vi.mocked(boostService.getBoostLevel).mockReturnValue(2);
      vi.mocked(boostQueries.isMemberBoosting).mockReturnValue(false);

      const perks = boosterPerksService.getMemberPerks('test-member', 'test-community');

      // Community perks at level 2 should be available
      expect(perks.communityPerks.length).toBeGreaterThan(0);
      // Booster perks should be unavailable (not boosting)
      expect(perks.boosterPerks).toHaveLength(0);
      // Level 3 perks should be unavailable
      expect(perks.unavailablePerks.length).toBeGreaterThan(0);
    });

    it('should include booster perks for active booster', () => {
      vi.mocked(boostService.getBoostLevel).mockReturnValue(2);
      vi.mocked(boostQueries.isMemberBoosting).mockReturnValue(true);

      const perks = boosterPerksService.getMemberPerks('test-member', 'test-community');

      expect(perks.boosterPerks.length).toBeGreaterThan(0);
      expect(perks.boosterPerks.every(p => p.scope === 'booster')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Discord Integration
  // ---------------------------------------------------------------------------

  describe('getBoosterRoleConfig', () => {
    it('should return no role for non-booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const config = boosterPerksService.getBoosterRoleConfig('test-member', 'test-community');

      expect(config.shouldHaveRole).toBe(false);
    });

    it('should return role config for active booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 3,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const config = boosterPerksService.getBoosterRoleConfig('test-member', 'test-community');

      expect(config.shouldHaveRole).toBe(true);
      expect(config.roleName).toBe('Server Supporter');
      expect(config.roleColor).toBe(BOOSTER_TIERS.supporter.color);
    });

    it('should return correct role name for each tier', () => {
      const tierRoles = [
        { months: 1, roleName: 'Booster' },
        { months: 3, roleName: 'Server Supporter' },
        { months: 6, roleName: 'Boost Champion' },
        { months: 12, roleName: 'Boost Legend' },
      ];

      tierRoles.forEach(({ months, roleName }) => {
        vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
          memberId: 'test-member',
          isActive: true,
          totalMonthsBoosted: months,
          firstBoostDate: new Date(),
          currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        const config = boosterPerksService.getBoosterRoleConfig('test-member', 'test-community');

        expect(config.roleName).toBe(roleName);
      });
    });
  });

  describe('getBoosterNicknameSuffix', () => {
    it('should return empty string for non-booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const suffix = boosterPerksService.getBoosterNicknameSuffix('test-member', 'test-community');

      expect(suffix).toBe('');
    });

    it('should return tier emoji as suffix', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 6,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const suffix = boosterPerksService.getBoosterNicknameSuffix('test-member', 'test-community');

      expect(suffix).toBe(` ${BOOSTER_TIERS.champion.emoji}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Anniversary & Milestones
  // ---------------------------------------------------------------------------

  describe('checkBoostAnniversary', () => {
    it('should return no anniversary for non-booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const result = boosterPerksService.checkBoostAnniversary('test-member', 'test-community');

      expect(result.hasAnniversary).toBe(false);
    });

    it('should detect upcoming anniversary', () => {
      const now = new Date();
      const firstBoost = new Date(now);
      firstBoost.setFullYear(now.getFullYear() - 1);
      firstBoost.setDate(now.getDate() + 3); // 3 days from now

      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 12,
        firstBoostDate: firstBoost,
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const result = boosterPerksService.checkBoostAnniversary('test-member', 'test-community', 7);

      expect(result.hasAnniversary).toBe(true);
      expect(result.yearsAsBooster).toBe(1);
    });
  });

  describe('getBoosterMilestones', () => {
    it('should return all milestones unachieved for non-booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue(null);

      const milestones = boosterPerksService.getBoosterMilestones('test-member', 'test-community');

      expect(milestones).toHaveLength(5);
      expect(milestones.every(m => !m.achieved)).toBe(true);
    });

    it('should return achieved milestones for active booster', () => {
      vi.mocked(boostQueries.getMemberBoosterInfo).mockReturnValue({
        memberId: 'test-member',
        isActive: true,
        totalMonthsBoosted: 7,
        firstBoostDate: new Date(),
        currentBoostExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const milestones = boosterPerksService.getBoosterMilestones('test-member', 'test-community');

      // Should have achieved: First Boost (1), Supporter (3), Champion (6)
      // Not achieved: Legend (12), Super Legend (24)
      const achieved = milestones.filter(m => m.achieved);
      expect(achieved).toHaveLength(3);
      expect(achieved.map(m => m.milestone)).toContain('First Boost');
      expect(achieved.map(m => m.milestone)).toContain('Supporter');
      expect(achieved.map(m => m.milestone)).toContain('Champion');
    });
  });

  // ---------------------------------------------------------------------------
  // BOOSTER_TIERS export
  // ---------------------------------------------------------------------------

  describe('BOOSTER_TIERS', () => {
    it('should export tier constants', () => {
      expect(BOOSTER_TIERS).toBeDefined();
      expect(BOOSTER_TIERS.new).toBeDefined();
      expect(BOOSTER_TIERS.supporter).toBeDefined();
      expect(BOOSTER_TIERS.champion).toBeDefined();
      expect(BOOSTER_TIERS.legend).toBeDefined();
    });

    it('should have correct emoji for each tier', () => {
      expect(BOOSTER_TIERS.new.emoji).toBe('🚀');
      expect(BOOSTER_TIERS.supporter.emoji).toBe('⭐');
      expect(BOOSTER_TIERS.champion.emoji).toBe('🏆');
      expect(BOOSTER_TIERS.legend.emoji).toBe('👑');
    });

    it('should have correct color for each tier', () => {
      expect(BOOSTER_TIERS.new.color).toBe('#9B59B6');
      expect(BOOSTER_TIERS.supporter.color).toBe('#F1C40F');
      expect(BOOSTER_TIERS.champion.color).toBe('#E67E22');
      expect(BOOSTER_TIERS.legend.color).toBe('#E74C3C');
    });
  });
});

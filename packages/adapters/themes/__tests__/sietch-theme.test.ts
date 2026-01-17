/**
 * Sietch Theme Tests
 * Sprint S-18: SietchTheme & Theme Registry
 *
 * Tests for SietchTheme implementation including v4.1 parity validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SietchTheme, sietchTheme } from '../sietch-theme.js';
import { validateTheme } from '../../../core/ports/theme-provider.js';
import type { Profile, ProfileHistory } from '../../../core/ports/theme-provider.js';

// --------------------------------------------------------------------------
// Test Fixtures
// --------------------------------------------------------------------------

const createMockProfile = (overrides: Partial<Profile> = {}): Profile => ({
  userId: 'user-123',
  communityId: 'community-456',
  score: 1000,
  rank: 5,
  tierId: 'fedaykin_elite',
  joinedAt: new Date('2024-01-01'),
  joinPosition: 25,
  manualBadges: [],
  ...overrides,
});

const createMockHistory = (overrides: Partial<ProfileHistory> = {}): ProfileHistory => ({
  tenureDays: 400,
  daysSinceLastActivity: 1,
  activityStreakDays: 35,
  balanceEverDropped: false,
  marketDownturnsSurvived: 4,
  eventsAttended: 12,
  daysAtRankOrBetter: 100,
  referralCount: 6,
  tiersReached: ['outsider', 'observer', 'aspirant', 'initiate', 'wanderer', 'fremen', 'fedaykin', 'fedaykin_elite'],
  ...overrides,
});

// --------------------------------------------------------------------------
// Theme Configuration Tests
// --------------------------------------------------------------------------

describe('SietchTheme', () => {
  describe('Theme Properties', () => {
    it('should have correct theme ID', () => {
      expect(sietchTheme.id).toBe('sietch');
    });

    it('should have correct theme name', () => {
      expect(sietchTheme.name).toBe('Sietch Theme');
    });

    it('should have correct description', () => {
      expect(sietchTheme.description).toBe('Dune-themed 9-tier progression (v4.1 parity)');
    });

    it('should require pro subscription', () => {
      expect(sietchTheme.subscriptionTier).toBe('pro');
    });
  });

  describe('Theme Validation', () => {
    it('should pass validation', () => {
      const result = validateTheme(sietchTheme);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should have no overlapping tier ranges', () => {
      const tiers = sietchTheme.getTierConfig();
      const sortedTiers = [...tiers].sort((a, b) => a.minRank - b.minRank);

      for (let i = 0; i < sortedTiers.length - 1; i++) {
        const current = sortedTiers[i];
        const next = sortedTiers[i + 1];
        expect(current.maxRank).toBeLessThan(next.minRank);
      }
    });

    it('should have unique tier IDs', () => {
      const tiers = sietchTheme.getTierConfig();
      const ids = tiers.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have unique badge IDs', () => {
      const badges = sietchTheme.getBadgeConfig();
      const ids = badges.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('Tier Configuration (v4.1 Parity)', () => {
    let tiers: ReturnType<typeof sietchTheme.getTierConfig>;

    beforeEach(() => {
      tiers = sietchTheme.getTierConfig();
    });

    it('should have exactly 9 tiers', () => {
      expect(tiers).toHaveLength(9);
    });

    it('should have correct tier order', () => {
      const tierNames = tiers.map((t) => t.name);
      expect(tierNames).toEqual([
        'Naib',
        'Fedaykin Elite',
        'Fedaykin',
        'Fremen',
        'Wanderer',
        'Initiate',
        'Aspirant',
        'Observer',
        'Outsider',
      ]);
    });

    // v4.1 Parity: Naib tier
    it('should have Naib tier for rank 1 only', () => {
      const naib = tiers.find((t) => t.id === 'naib');
      expect(naib).toBeDefined();
      expect(naib!.minRank).toBe(1);
      expect(naib!.maxRank).toBe(1);
      expect(naib!.roleColor).toBe(0xffd700);
      expect(naib!.emoji).toBe('👑');
      expect(naib!.permissions).toContain('naib_council');
    });

    // v4.1 Parity: Fedaykin Elite tier
    it('should have Fedaykin Elite tier for ranks 2-5', () => {
      const fedElite = tiers.find((t) => t.id === 'fedaykin_elite');
      expect(fedElite).toBeDefined();
      expect(fedElite!.minRank).toBe(2);
      expect(fedElite!.maxRank).toBe(5);
      expect(fedElite!.roleColor).toBe(0x9400d3);
      expect(fedElite!.emoji).toBe('⚔️');
    });

    // v4.1 Parity: Fedaykin tier
    it('should have Fedaykin tier for ranks 6-15', () => {
      const fed = tiers.find((t) => t.id === 'fedaykin');
      expect(fed).toBeDefined();
      expect(fed!.minRank).toBe(6);
      expect(fed!.maxRank).toBe(15);
      expect(fed!.roleColor).toBe(0x800080);
      expect(fed!.emoji).toBe('🗡️');
    });

    // v4.1 Parity: Fremen tier
    it('should have Fremen tier for ranks 16-30', () => {
      const fremen = tiers.find((t) => t.id === 'fremen');
      expect(fremen).toBeDefined();
      expect(fremen!.minRank).toBe(16);
      expect(fremen!.maxRank).toBe(30);
      expect(fremen!.roleColor).toBe(0x1e90ff);
      expect(fremen!.emoji).toBe('🏜️');
    });

    // v4.1 Parity: Wanderer tier
    it('should have Wanderer tier for ranks 31-50', () => {
      const wanderer = tiers.find((t) => t.id === 'wanderer');
      expect(wanderer).toBeDefined();
      expect(wanderer!.minRank).toBe(31);
      expect(wanderer!.maxRank).toBe(50);
      expect(wanderer!.roleColor).toBe(0x32cd32);
      expect(wanderer!.emoji).toBe('🚶');
    });

    // v4.1 Parity: Initiate tier
    it('should have Initiate tier for ranks 51-75', () => {
      const initiate = tiers.find((t) => t.id === 'initiate');
      expect(initiate).toBeDefined();
      expect(initiate!.minRank).toBe(51);
      expect(initiate!.maxRank).toBe(75);
      expect(initiate!.roleColor).toBe(0xffff00);
      expect(initiate!.emoji).toBe('📚');
    });

    // v4.1 Parity: Aspirant tier
    it('should have Aspirant tier for ranks 76-100', () => {
      const aspirant = tiers.find((t) => t.id === 'aspirant');
      expect(aspirant).toBeDefined();
      expect(aspirant!.minRank).toBe(76);
      expect(aspirant!.maxRank).toBe(100);
      expect(aspirant!.roleColor).toBe(0xffa500);
      expect(aspirant!.emoji).toBe('🌱');
    });

    // v4.1 Parity: Observer tier
    it('should have Observer tier for ranks 101-200', () => {
      const observer = tiers.find((t) => t.id === 'observer');
      expect(observer).toBeDefined();
      expect(observer!.minRank).toBe(101);
      expect(observer!.maxRank).toBe(200);
      expect(observer!.roleColor).toBe(0x808080);
      expect(observer!.emoji).toBe('👁️');
    });

    // v4.1 Parity: Outsider tier
    it('should have Outsider tier for ranks 201+', () => {
      const outsider = tiers.find((t) => t.id === 'outsider');
      expect(outsider).toBeDefined();
      expect(outsider!.minRank).toBe(201);
      expect(outsider!.maxRank).toBe(Number.MAX_SAFE_INTEGER);
      expect(outsider!.roleColor).toBe(0x696969);
      expect(outsider!.emoji).toBe('🌍');
    });
  });

  describe('Badge Configuration (v4.1 Parity)', () => {
    let badges: ReturnType<typeof sietchTheme.getBadgeConfig>;

    beforeEach(() => {
      badges = sietchTheme.getBadgeConfig();
    });

    it('should have exactly 10 badges', () => {
      expect(badges).toHaveLength(10);
    });

    // v4.1 Parity: First Wave badge
    it('should have First Wave badge (join_order)', () => {
      const badge = badges.find((b) => b.id === 'first_wave');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('join_order');
      expect(badge!.parameters.maxPosition).toBe(50);
      expect(badge!.rarity).toBe('legendary');
      expect(badge!.emoji).toBe('🌊');
    });

    // v4.1 Parity: Veteran badge
    it('should have Veteran badge (tenure)', () => {
      const badge = badges.find((b) => b.id === 'veteran');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('tenure');
      expect(badge!.parameters.minDays).toBe(365);
      expect(badge!.rarity).toBe('rare');
      expect(badge!.emoji).toBe('🎖️');
    });

    // v4.1 Parity: Diamond Hands badge
    it('should have Diamond Hands badge (balance_stability)', () => {
      const badge = badges.find((b) => b.id === 'diamond_hands');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('balance_stability');
      expect(badge!.parameters.minRetention).toBe(1.0);
      expect(badge!.rarity).toBe('epic');
      expect(badge!.emoji).toBe('💎');
    });

    // v4.1 Parity: Council badge
    it('should have Council Member badge (tier_reached)', () => {
      const badge = badges.find((b) => b.id === 'council');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('tier_reached');
      expect(badge!.parameters.tierId).toBe('naib');
      expect(badge!.rarity).toBe('legendary');
      expect(badge!.emoji).toBe('🏛️');
    });

    // v4.1 Parity: Survivor badge
    it('should have Survivor badge (market_survival)', () => {
      const badge = badges.find((b) => b.id === 'survivor');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('market_survival');
      expect(badge!.parameters.minEvents).toBe(3);
      expect(badge!.rarity).toBe('epic');
      expect(badge!.emoji).toBe('🛡️');
    });

    // v4.1 Parity: Streak Master badge
    it('should have Streak Master badge (activity_streak)', () => {
      const badge = badges.find((b) => b.id === 'streak_master');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('activity_streak');
      expect(badge!.parameters.minStreak).toBe(30);
      expect(badge!.rarity).toBe('rare');
      expect(badge!.emoji).toBe('🔥');
    });

    // v4.1 Parity: Engaged badge
    it('should have Engaged badge (event_participation)', () => {
      const badge = badges.find((b) => b.id === 'engaged');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('event_participation');
      expect(badge!.parameters.minEvents).toBe(10);
      expect(badge!.rarity).toBe('uncommon');
      expect(badge!.emoji).toBe('🎯');
    });

    // v4.1 Parity: Contributor badge
    it('should have Contributor badge (manual_grant)', () => {
      const badge = badges.find((b) => b.id === 'contributor');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('manual_grant');
      expect(badge!.rarity).toBe('epic');
      expect(badge!.emoji).toBe('🤝');
    });

    // v4.1 Parity: Pillar badge
    it('should have Pillar badge (rank_tenure)', () => {
      const badge = badges.find((b) => b.id === 'pillar');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('rank_tenure');
      expect(badge!.parameters.maxRank).toBe(10);
      expect(badge!.parameters.minDays).toBe(90);
      expect(badge!.rarity).toBe('legendary');
      expect(badge!.emoji).toBe('🏆');
    });

    // v4.1 Parity: Water Sharer badge
    it('should have Water Sharer badge (referrals)', () => {
      const badge = badges.find((b) => b.id === 'water_sharer');
      expect(badge).toBeDefined();
      expect(badge!.evaluator).toBe('referrals');
      expect(badge!.parameters.minReferrals).toBe(5);
      expect(badge!.rarity).toBe('rare');
      expect(badge!.emoji).toBe('💧');
    });
  });

  describe('Naming Configuration (v4.1 Parity)', () => {
    it('should have empty tier prefix', () => {
      const naming = sietchTheme.getNamingConfig();
      expect(naming.tierPrefix).toBe('');
    });

    it('should have empty tier suffix', () => {
      const naming = sietchTheme.getNamingConfig();
      expect(naming.tierSuffix).toBe('');
    });

    it('should use "Sietch" as community noun', () => {
      const naming = sietchTheme.getNamingConfig();
      expect(naming.communityNoun).toBe('Sietch');
    });

    it('should use "Conviction Rankings" as leaderboard title', () => {
      const naming = sietchTheme.getNamingConfig();
      expect(naming.leaderboardTitle).toBe('Conviction Rankings');
    });

    it('should use "Conviction" as score label', () => {
      const naming = sietchTheme.getNamingConfig();
      expect(naming.scoreLabel).toBe('Conviction');
    });
  });

  describe('Tier Evaluation (v4.1 Parity)', () => {
    it('should return Naib for rank 1', () => {
      const result = sietchTheme.evaluateTier(10000, 1000, 1);
      expect(result.tier.id).toBe('naib');
      expect(result.tier.name).toBe('Naib');
    });

    it('should return Fedaykin Elite for ranks 2-5', () => {
      for (const rank of [2, 3, 4, 5]) {
        const result = sietchTheme.evaluateTier(5000, 1000, rank);
        expect(result.tier.id).toBe('fedaykin_elite');
      }
    });

    it('should return Fedaykin for ranks 6-15', () => {
      for (const rank of [6, 10, 15]) {
        const result = sietchTheme.evaluateTier(3000, 1000, rank);
        expect(result.tier.id).toBe('fedaykin');
      }
    });

    it('should return Fremen for ranks 16-30', () => {
      for (const rank of [16, 23, 30]) {
        const result = sietchTheme.evaluateTier(2000, 1000, rank);
        expect(result.tier.id).toBe('fremen');
      }
    });

    it('should return Wanderer for ranks 31-50', () => {
      for (const rank of [31, 40, 50]) {
        const result = sietchTheme.evaluateTier(1500, 1000, rank);
        expect(result.tier.id).toBe('wanderer');
      }
    });

    it('should return Initiate for ranks 51-75', () => {
      for (const rank of [51, 63, 75]) {
        const result = sietchTheme.evaluateTier(1000, 1000, rank);
        expect(result.tier.id).toBe('initiate');
      }
    });

    it('should return Aspirant for ranks 76-100', () => {
      for (const rank of [76, 88, 100]) {
        const result = sietchTheme.evaluateTier(800, 1000, rank);
        expect(result.tier.id).toBe('aspirant');
      }
    });

    it('should return Observer for ranks 101-200', () => {
      for (const rank of [101, 150, 200]) {
        const result = sietchTheme.evaluateTier(500, 1000, rank);
        expect(result.tier.id).toBe('observer');
      }
    });

    it('should return Outsider for ranks 201+', () => {
      for (const rank of [201, 500, 1000]) {
        const result = sietchTheme.evaluateTier(100, 1000, rank);
        expect(result.tier.id).toBe('outsider');
      }
    });

    it('should calculate correct percentile', () => {
      const result = sietchTheme.evaluateTier(5000, 100, 1);
      expect(result.percentile).toBe(100);

      const result2 = sietchTheme.evaluateTier(100, 100, 50);
      expect(result2.percentile).toBe(51);

      const result3 = sietchTheme.evaluateTier(50, 100, 100);
      expect(result3.percentile).toBe(1);
    });

    it('should handle edge case with zero members', () => {
      const result = sietchTheme.evaluateTier(1000, 0, 1);
      expect(result.percentile).toBe(0);
    });
  });

  describe('Badge Evaluation', () => {
    it('should return all qualifying badges for profile with full history', () => {
      const profile = createMockProfile({
        rank: 5,
        tierId: 'fedaykin_elite',
        joinPosition: 25,
        manualBadges: ['contributor'],
      });
      const history = createMockHistory({
        tenureDays: 400,
        activityStreakDays: 35,
        balanceEverDropped: false,
        marketDownturnsSurvived: 4,
        eventsAttended: 12,
        daysAtRankOrBetter: 100,
        referralCount: 6,
        tiersReached: ['naib'], // Reached naib at some point
      });

      const badges = sietchTheme.evaluateBadges(profile, history);

      // Should have: first_wave (25 < 50), veteran (400 > 365), diamond_hands,
      // council (reached naib), survivor (4 >= 3), streak_master (35 >= 30),
      // engaged (12 >= 10), contributor (manual), pillar (5 <= 10, 100 >= 90),
      // water_sharer (6 >= 5)
      expect(badges.length).toBe(10);
    });

    it('should return limited badges for new member', () => {
      const profile = createMockProfile({
        rank: 150,
        tierId: 'observer',
        joinPosition: 200,
        manualBadges: [],
      });
      const history = createMockHistory({
        tenureDays: 30,
        activityStreakDays: 5,
        balanceEverDropped: true,
        marketDownturnsSurvived: 0,
        eventsAttended: 2,
        daysAtRankOrBetter: 10,
        referralCount: 0,
        tiersReached: ['observer'],
      });

      const badges = sietchTheme.evaluateBadges(profile, history);

      // New member shouldn't qualify for most badges
      expect(badges.length).toBe(0);
    });

    it('should award First Wave for join position <= 50', () => {
      const profile = createMockProfile({ joinPosition: 50 });
      const history = createMockHistory();

      const badges = sietchTheme.evaluateBadges(profile, history);
      const firstWave = badges.find((b) => b.badge.id === 'first_wave');

      expect(firstWave).toBeDefined();
    });

    it('should NOT award First Wave for join position > 50', () => {
      const profile = createMockProfile({ joinPosition: 51 });
      const history = createMockHistory();

      const badges = sietchTheme.evaluateBadges(profile, history);
      const firstWave = badges.find((b) => b.badge.id === 'first_wave');

      expect(firstWave).toBeUndefined();
    });

    it('should award Veteran for tenure >= 365 days', () => {
      const profile = createMockProfile();
      const history = createMockHistory({ tenureDays: 365 });

      const badges = sietchTheme.evaluateBadges(profile, history);
      const veteran = badges.find((b) => b.badge.id === 'veteran');

      expect(veteran).toBeDefined();
    });

    it('should award Diamond Hands when balance never dropped', () => {
      const profile = createMockProfile();
      const history = createMockHistory({ balanceEverDropped: false });

      const badges = sietchTheme.evaluateBadges(profile, history);
      const diamondHands = badges.find((b) => b.badge.id === 'diamond_hands');

      expect(diamondHands).toBeDefined();
    });

    it('should award Council when naib tier reached', () => {
      const profile = createMockProfile();
      const history = createMockHistory({ tiersReached: ['naib'] });

      const badges = sietchTheme.evaluateBadges(profile, history);
      const council = badges.find((b) => b.badge.id === 'council');

      expect(council).toBeDefined();
    });
  });

  describe('Singleton Export', () => {
    it('should export singleton instance', () => {
      expect(sietchTheme).toBeInstanceOf(SietchTheme);
    });

    it('should return same values as new instance', () => {
      const newInstance = new SietchTheme();
      expect(newInstance.getTierConfig()).toEqual(sietchTheme.getTierConfig());
      expect(newInstance.getBadgeConfig()).toEqual(sietchTheme.getBadgeConfig());
      expect(newInstance.getNamingConfig()).toEqual(sietchTheme.getNamingConfig());
    });
  });

  describe('Config Immutability', () => {
    it('should return new array for tiers', () => {
      const tiers1 = sietchTheme.getTierConfig();
      const tiers2 = sietchTheme.getTierConfig();
      expect(tiers1).not.toBe(tiers2);
      expect(tiers1).toEqual(tiers2);
    });

    it('should return new array for badges', () => {
      const badges1 = sietchTheme.getBadgeConfig();
      const badges2 = sietchTheme.getBadgeConfig();
      expect(badges1).not.toBe(badges2);
      expect(badges1).toEqual(badges2);
    });

    it('should return new object for naming', () => {
      const naming1 = sietchTheme.getNamingConfig();
      const naming2 = sietchTheme.getNamingConfig();
      expect(naming1).not.toBe(naming2);
      expect(naming1).toEqual(naming2);
    });
  });
});

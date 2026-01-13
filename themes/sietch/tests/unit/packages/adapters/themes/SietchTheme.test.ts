/**
 * SietchTheme Unit Tests
 *
 * Sprint 37: SietchTheme Implementation
 *
 * v4.1 Regression Test Suite (50+ test cases)
 * Tests for the premium Dune-inspired theme with 9 tiers and 12 badges.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SietchTheme,
  createSietchTheme,
  sietchTheme,
  BGT_THRESHOLDS,
  RANK_BOUNDARIES,
} from '../../../../../src/packages/adapters/themes/SietchTheme.js';
import type {
  MemberContext,
  TierConfig,
  BadgeConfig,
  TierResult,
  EarnedBadge,
} from '../../../../../src/packages/core/ports/IThemeProvider.js';

describe('SietchTheme', () => {
  let theme: SietchTheme;

  beforeEach(() => {
    theme = new SietchTheme();
  });

  // ===========================================================================
  // Basic Theme Properties
  // ===========================================================================

  describe('theme properties', () => {
    it('should have correct themeId', () => {
      expect(theme.themeId).toBe('sietch');
    });

    it('should have correct themeName', () => {
      expect(theme.themeName).toBe('Sietch (Dune)');
    });

    it('should be premium tier', () => {
      expect(theme.tier).toBe('premium');
    });
  });

  // ===========================================================================
  // Tier Configuration (9 tiers)
  // ===========================================================================

  describe('getTierConfig', () => {
    let tierConfig: TierConfig;

    beforeEach(() => {
      tierConfig = theme.getTierConfig();
    });

    it('should return 9 tiers', () => {
      expect(tierConfig.tiers).toHaveLength(9);
    });

    it('should use absolute ranking strategy', () => {
      expect(tierConfig.rankingStrategy).toBe('absolute');
    });

    it('should have 24-hour demotion grace period', () => {
      expect(tierConfig.demotionGracePeriod).toBe(24);
    });

    it('should return defensive copy of tiers', () => {
      const config1 = theme.getTierConfig();
      const config2 = theme.getTierConfig();
      expect(config1.tiers).not.toBe(config2.tiers);
    });

    describe('tier order (highest to lowest)', () => {
      it('should have Naib at index 0 (highest)', () => {
        expect(tierConfig.tiers[0].id).toBe('naib');
      });

      it('should have Fedaykin at index 1', () => {
        expect(tierConfig.tiers[1].id).toBe('fedaykin');
      });

      it('should have Usul at index 2', () => {
        expect(tierConfig.tiers[2].id).toBe('usul');
      });

      it('should have Sayyadina at index 3', () => {
        expect(tierConfig.tiers[3].id).toBe('sayyadina');
      });

      it('should have Mushtamal at index 4', () => {
        expect(tierConfig.tiers[4].id).toBe('mushtamal');
      });

      it('should have Sihaya at index 5', () => {
        expect(tierConfig.tiers[5].id).toBe('sihaya');
      });

      it('should have Qanat at index 6', () => {
        expect(tierConfig.tiers[6].id).toBe('qanat');
      });

      it('should have Ichwan at index 7', () => {
        expect(tierConfig.tiers[7].id).toBe('ichwan');
      });

      it('should have Hajra at index 8 (lowest)', () => {
        expect(tierConfig.tiers[8].id).toBe('hajra');
      });
    });

    describe('tier rank boundaries', () => {
      it('should have Naib: rank 1-7', () => {
        const naib = tierConfig.tiers[0];
        expect(naib.minRank).toBe(1);
        expect(naib.maxRank).toBe(7);
      });

      it('should have Fedaykin: rank 8-69', () => {
        const fedaykin = tierConfig.tiers[1];
        expect(fedaykin.minRank).toBe(8);
        expect(fedaykin.maxRank).toBe(69);
      });

      it('should have Usul: rank 70-100', () => {
        const usul = tierConfig.tiers[2];
        expect(usul.minRank).toBe(70);
        expect(usul.maxRank).toBe(100);
      });

      it('should have Hajra: rank 1001+ (no max)', () => {
        const hajra = tierConfig.tiers[8];
        expect(hajra.minRank).toBe(1001);
        expect(hajra.maxRank).toBeNull();
      });
    });

    describe('tier role colors', () => {
      it('should have gold color for Naib (#FFD700)', () => {
        expect(tierConfig.tiers[0].roleColor).toBe('#FFD700');
      });

      it('should have royal blue for Fedaykin (#4169E1)', () => {
        expect(tierConfig.tiers[1].roleColor).toBe('#4169E1');
      });

      it('should have purple for Usul (#9B59B6)', () => {
        expect(tierConfig.tiers[2].roleColor).toBe('#9B59B6');
      });

      it('should have sand color for Hajra (#C2B280)', () => {
        expect(tierConfig.tiers[8].roleColor).toBe('#C2B280');
      });
    });

    describe('tier permissions', () => {
      it('should give Naib all permissions including governance', () => {
        const naib = tierConfig.tiers[0];
        expect(naib.permissions).toContain('view_all');
        expect(naib.permissions).toContain('council_access');
        expect(naib.permissions).toContain('govern');
        expect(naib.permissions).toContain('naib_ceremony');
      });

      it('should give Fedaykin elite access and water sharing', () => {
        const fedaykin = tierConfig.tiers[1];
        expect(fedaykin.permissions).toContain('view_all');
        expect(fedaykin.permissions).toContain('elite_access');
        expect(fedaykin.permissions).toContain('water_share');
      });

      it('should give Hajra only general viewing', () => {
        const hajra = tierConfig.tiers[8];
        expect(hajra.permissions).toEqual(['view_general']);
      });
    });
  });

  // ===========================================================================
  // Tier Evaluation
  // ===========================================================================

  describe('evaluateTier', () => {
    describe('Naib tier (rank 1-7)', () => {
      it('should return Naib for rank 1', () => {
        const result = theme.evaluateTier(1);
        expect(result.tierId).toBe('naib');
        expect(result.tierName).toBe('Naib');
        expect(result.rankInTier).toBe(1);
      });

      it('should return Naib for rank 7', () => {
        const result = theme.evaluateTier(7);
        expect(result.tierId).toBe('naib');
        expect(result.rankInTier).toBe(7);
      });
    });

    describe('Fedaykin tier (rank 8-69)', () => {
      it('should return Fedaykin for rank 8', () => {
        const result = theme.evaluateTier(8);
        expect(result.tierId).toBe('fedaykin');
        expect(result.tierName).toBe('Fedaykin');
        expect(result.rankInTier).toBe(1);
      });

      it('should return Fedaykin for rank 69', () => {
        const result = theme.evaluateTier(69);
        expect(result.tierId).toBe('fedaykin');
        expect(result.rankInTier).toBe(62);
      });

      it('should return Fedaykin for rank 35 (middle)', () => {
        const result = theme.evaluateTier(35);
        expect(result.tierId).toBe('fedaykin');
      });
    });

    describe('Usul tier (rank 70-100)', () => {
      it('should return Usul for rank 70', () => {
        const result = theme.evaluateTier(70);
        expect(result.tierId).toBe('usul');
        expect(result.tierName).toBe('Usul');
        expect(result.rankInTier).toBe(1);
      });

      it('should return Usul for rank 100', () => {
        const result = theme.evaluateTier(100);
        expect(result.tierId).toBe('usul');
        expect(result.rankInTier).toBe(31);
      });
    });

    describe('lower tiers', () => {
      it('should return Sayyadina for rank 101', () => {
        const result = theme.evaluateTier(101);
        expect(result.tierId).toBe('sayyadina');
      });

      it('should return Mushtamal for rank 175', () => {
        const result = theme.evaluateTier(175);
        expect(result.tierId).toBe('mushtamal');
      });

      it('should return Sihaya for rank 250', () => {
        const result = theme.evaluateTier(250);
        expect(result.tierId).toBe('sihaya');
      });

      it('should return Qanat for rank 400', () => {
        const result = theme.evaluateTier(400);
        expect(result.tierId).toBe('qanat');
      });

      it('should return Ichwan for rank 750', () => {
        const result = theme.evaluateTier(750);
        expect(result.tierId).toBe('ichwan');
      });

      it('should return Hajra for rank 1001', () => {
        const result = theme.evaluateTier(1001);
        expect(result.tierId).toBe('hajra');
        expect(result.rankInTier).toBe(1);
      });
    });

    describe('edge cases', () => {
      it('should return Naib for rank 0 (invalid)', () => {
        const result = theme.evaluateTier(0);
        expect(result.tierId).toBe('naib');
      });

      it('should return Naib for negative rank (invalid)', () => {
        const result = theme.evaluateTier(-5);
        expect(result.tierId).toBe('naib');
      });

      it('should return Hajra for very high rank (10000)', () => {
        const result = theme.evaluateTier(10000);
        expect(result.tierId).toBe('hajra');
      });
    });

    describe('boundary testing', () => {
      const boundaries = [
        { rank: 7, expected: 'naib' },
        { rank: 8, expected: 'fedaykin' },
        { rank: 69, expected: 'fedaykin' },
        { rank: 70, expected: 'usul' },
        { rank: 100, expected: 'usul' },
        { rank: 101, expected: 'sayyadina' },
        { rank: 150, expected: 'sayyadina' },
        { rank: 151, expected: 'mushtamal' },
        { rank: 200, expected: 'mushtamal' },
        { rank: 201, expected: 'sihaya' },
        { rank: 300, expected: 'sihaya' },
        { rank: 301, expected: 'qanat' },
        { rank: 500, expected: 'qanat' },
        { rank: 501, expected: 'ichwan' },
        { rank: 1000, expected: 'ichwan' },
        { rank: 1001, expected: 'hajra' },
      ];

      boundaries.forEach(({ rank, expected }) => {
        it(`should return ${expected} for rank ${rank}`, () => {
          const result = theme.evaluateTier(rank);
          expect(result.tierId).toBe(expected);
        });
      });
    });
  });

  // ===========================================================================
  // Badge Configuration (12 badges)
  // ===========================================================================

  describe('getBadgeConfig', () => {
    let badgeConfig: BadgeConfig;

    beforeEach(() => {
      badgeConfig = theme.getBadgeConfig();
    });

    it('should return 12 badges', () => {
      expect(badgeConfig.badges).toHaveLength(12);
    });

    it('should return all 4 categories', () => {
      expect(badgeConfig.categories).toContain('tenure');
      expect(badgeConfig.categories).toContain('achievement');
      expect(badgeConfig.categories).toContain('activity');
      expect(badgeConfig.categories).toContain('special');
    });

    it('should return defensive copy of badges', () => {
      const config1 = theme.getBadgeConfig();
      const config2 = theme.getBadgeConfig();
      expect(config1.badges).not.toBe(config2.badges);
    });

    describe('tenure badges', () => {
      it('should have OG badge (180 days)', () => {
        const og = badgeConfig.badges.find((b) => b.id === 'og');
        expect(og).toBeDefined();
        expect(og?.criteria.type).toBe('tenure');
        expect(og?.criteria.threshold).toBe(180);
        expect(og?.emoji).toBe('🏛️');
      });

      it('should have Veteran badge (90 days)', () => {
        const veteran = badgeConfig.badges.find((b) => b.id === 'veteran');
        expect(veteran).toBeDefined();
        expect(veteran?.criteria.threshold).toBe(90);
      });

      it('should have Elder badge (365 days)', () => {
        const elder = badgeConfig.badges.find((b) => b.id === 'elder');
        expect(elder).toBeDefined();
        expect(elder?.criteria.threshold).toBe(365);
      });
    });

    describe('achievement badges', () => {
      it('should have Naib Ascended badge', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'naib_ascended');
        expect(badge).toBeDefined();
        expect(badge?.criteria.type).toBe('tier_reached');
        expect(badge?.criteria.tierRequired).toBe('naib');
        expect(badge?.emoji).toBe('👑');
      });

      it('should have Fedaykin Initiated badge', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'fedaykin_initiated');
        expect(badge).toBeDefined();
        expect(badge?.criteria.tierRequired).toBe('fedaykin');
      });

      it('should have Usul Ascended badge', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'usul_ascended');
        expect(badge).toBeDefined();
        expect(badge?.criteria.tierRequired).toBe('usul');
      });

      it('should have First Maker badge (conviction 10000)', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'first_maker');
        expect(badge).toBeDefined();
        expect(badge?.criteria.type).toBe('conviction');
        expect(badge?.criteria.threshold).toBe(10000);
      });
    });

    describe('activity badges', () => {
      it('should have Desert Active badge (50 activity)', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'desert_active');
        expect(badge).toBeDefined();
        expect(badge?.criteria.type).toBe('activity');
        expect(badge?.criteria.threshold).toBe(50);
        expect(badge?.revocable).toBe(true);
      });

      it('should have Sietch Engaged badge (200 activity)', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'sietch_engaged');
        expect(badge).toBeDefined();
        expect(badge?.criteria.threshold).toBe(200);
      });
    });

    describe('special badges', () => {
      it('should have Water Sharer badge', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'water_sharer');
        expect(badge).toBeDefined();
        expect(badge?.criteria.type).toBe('custom');
        expect(badge?.criteria.customEvaluator).toBe('waterSharerCheck');
        expect(badge?.emoji).toBe('💧');
        expect(badge?.revocable).toBe(true);
      });

      it('should have Former Naib badge', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'former_naib');
        expect(badge).toBeDefined();
        expect(badge?.criteria.customEvaluator).toBe('formerNaibCheck');
      });

      it('should have Founding Naib badge', () => {
        const badge = badgeConfig.badges.find((b) => b.id === 'founding_naib');
        expect(badge).toBeDefined();
        expect(badge?.criteria.customEvaluator).toBe('foundingNaibCheck');
      });
    });
  });

  // ===========================================================================
  // Badge Evaluation
  // ===========================================================================

  describe('evaluateBadges', () => {
    function createMemberContext(overrides: Partial<MemberContext> = {}): MemberContext {
      return {
        address: '0x1234567890123456789012345678901234567890',
        rank: 100,
        convictionScore: 0,
        activityScore: 0,
        firstClaimAt: new Date(),
        lastActivityAt: new Date(),
        tenureDays: 0,
        ...overrides,
      };
    }

    describe('tenure badge evaluation', () => {
      it('should award Veteran badge for 90+ days', () => {
        const member = createMemberContext({ tenureDays: 90 });
        const earned = theme.evaluateBadges(member);
        const veteran = earned.find((b) => b.badgeId === 'veteran');
        expect(veteran).toBeDefined();
      });

      it('should not award Veteran badge for 89 days', () => {
        const member = createMemberContext({ tenureDays: 89 });
        const earned = theme.evaluateBadges(member);
        const veteran = earned.find((b) => b.badgeId === 'veteran');
        expect(veteran).toBeUndefined();
      });

      it('should award OG badge for 180+ days', () => {
        const member = createMemberContext({ tenureDays: 180 });
        const earned = theme.evaluateBadges(member);
        const og = earned.find((b) => b.badgeId === 'og');
        expect(og).toBeDefined();
      });

      it('should award Elder badge for 365+ days', () => {
        const member = createMemberContext({ tenureDays: 365 });
        const earned = theme.evaluateBadges(member);
        const elder = earned.find((b) => b.badgeId === 'elder');
        expect(elder).toBeDefined();
      });

      it('should award all tenure badges for long-term member', () => {
        const member = createMemberContext({ tenureDays: 400 });
        const earned = theme.evaluateBadges(member);
        expect(earned.find((b) => b.badgeId === 'veteran')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'og')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'elder')).toBeDefined();
      });
    });

    describe('tier_reached badge evaluation', () => {
      it('should award Naib Ascended for current naib tier', () => {
        const member = createMemberContext({ currentTier: 'naib' });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'naib_ascended');
        expect(badge).toBeDefined();
      });

      it('should award Naib Ascended for highest naib tier', () => {
        const member = createMemberContext({
          currentTier: 'fedaykin',
          highestTier: 'naib',
        });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'naib_ascended');
        expect(badge).toBeDefined();
      });

      it('should award Fedaykin Initiated for fedaykin tier or higher', () => {
        const member = createMemberContext({ currentTier: 'fedaykin' });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'fedaykin_initiated');
        expect(badge).toBeDefined();
      });

      it('should award Fedaykin Initiated if naib (higher tier)', () => {
        const member = createMemberContext({ currentTier: 'naib' });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'fedaykin_initiated');
        expect(badge).toBeDefined();
      });

      it('should not award Naib Ascended for fedaykin tier', () => {
        const member = createMemberContext({ currentTier: 'fedaykin' });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'naib_ascended');
        expect(badge).toBeUndefined();
      });

      it('should award Usul Ascended for usul tier', () => {
        const member = createMemberContext({ currentTier: 'usul' });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'usul_ascended');
        expect(badge).toBeDefined();
      });
    });

    describe('activity badge evaluation', () => {
      it('should award Desert Active for 50+ activity', () => {
        const member = createMemberContext({ activityScore: 50 });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'desert_active');
        expect(badge).toBeDefined();
      });

      it('should not award Desert Active for 49 activity', () => {
        const member = createMemberContext({ activityScore: 49 });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'desert_active');
        expect(badge).toBeUndefined();
      });

      it('should award Sietch Engaged for 200+ activity', () => {
        const member = createMemberContext({ activityScore: 200 });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'sietch_engaged');
        expect(badge).toBeDefined();
      });
    });

    describe('conviction badge evaluation', () => {
      it('should award First Maker for 10000+ conviction', () => {
        const member = createMemberContext({ convictionScore: 10000 });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'first_maker');
        expect(badge).toBeDefined();
      });

      it('should not award First Maker for 9999 conviction', () => {
        const member = createMemberContext({ convictionScore: 9999 });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'first_maker');
        expect(badge).toBeUndefined();
      });
    });

    describe('custom badge evaluation', () => {
      it('should not award custom badges without customContext', () => {
        const member = createMemberContext({});
        const earned = theme.evaluateBadges(member);
        const waterSharer = earned.find((b) => b.badgeId === 'water_sharer');
        expect(waterSharer).toBeUndefined();
      });

      it('should award Water Sharer with customContext (boolean)', () => {
        const member = createMemberContext({
          customContext: { waterSharerCheck: true },
        });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'water_sharer');
        expect(badge).toBeDefined();
      });

      it('should award custom badge with context object', () => {
        const member = createMemberContext({
          customContext: {
            waterSharerCheck: {
              earned: true,
              context: { sharedWith: 'member-123', lineageDepth: 2 },
            },
          },
        });
        const earned = theme.evaluateBadges(member);
        const badge = earned.find((b) => b.badgeId === 'water_sharer');
        expect(badge).toBeDefined();
        expect(badge?.context).toEqual({ sharedWith: 'member-123', lineageDepth: 2 });
      });
    });

    describe('combined scenarios', () => {
      it('should award multiple badges for qualified member', () => {
        const member = createMemberContext({
          tenureDays: 200,
          currentTier: 'naib',
          activityScore: 250,
          convictionScore: 15000,
        });
        const earned = theme.evaluateBadges(member);

        // Should have tenure badges
        expect(earned.find((b) => b.badgeId === 'veteran')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'og')).toBeDefined();

        // Should have achievement badges
        expect(earned.find((b) => b.badgeId === 'naib_ascended')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'fedaykin_initiated')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'usul_ascended')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'first_maker')).toBeDefined();

        // Should have activity badges
        expect(earned.find((b) => b.badgeId === 'desert_active')).toBeDefined();
        expect(earned.find((b) => b.badgeId === 'sietch_engaged')).toBeDefined();
      });

      it('should award no badges for new member', () => {
        const member = createMemberContext({
          tenureDays: 0,
          currentTier: 'hajra',
          activityScore: 0,
          convictionScore: 0,
        });
        const earned = theme.evaluateBadges(member);
        expect(earned).toHaveLength(0);
      });
    });
  });

  // ===========================================================================
  // Naming Configuration
  // ===========================================================================

  describe('getNamingConfig', () => {
    it('should return Dune-themed server name template', () => {
      const config = theme.getNamingConfig();
      expect(config.serverNameTemplate).toBe('{community} Sietch');
    });

    it('should return Dune-themed category names', () => {
      const config = theme.getNamingConfig();
      expect(config.categoryNames.info).toBe('SIETCH SCROLLS');
      expect(config.categoryNames.council).toBe('NAIB COUNCIL');
      expect(config.categoryNames.general).toBe('COMMON GROUNDS');
      expect(config.categoryNames.operations).toBe('THE STILLSUIT');
    });

    it('should return Dune terminology', () => {
      const config = theme.getNamingConfig();
      expect(config.terminology.member).toBe('Fremen');
      expect(config.terminology.holder).toBe('Sietch Dweller');
      expect(config.terminology.admin).toBe('Naib');
      expect(config.terminology.community).toBe('Sietch');
    });
  });

  // ===========================================================================
  // Channel Template
  // ===========================================================================

  describe('getChannelTemplate', () => {
    it('should return 7 categories', () => {
      const template = theme.getChannelTemplate();
      expect(template.categories).toHaveLength(7);
    });

    it('should have sietch scrolls category', () => {
      const template = theme.getChannelTemplate();
      const scrolls = template.categories.find((c) => c.id === 'sietch-scrolls');
      expect(scrolls).toBeDefined();
      expect(scrolls?.channels.length).toBeGreaterThan(0);
    });

    it('should have naib council with tier restriction', () => {
      const template = theme.getChannelTemplate();
      const council = template.categories.find((c) => c.id === 'naib-council');
      expect(council).toBeDefined();
      expect(council?.tierRestriction).toBe('naib');
    });

    it('should have fedaykin quarters with tier restriction', () => {
      const template = theme.getChannelTemplate();
      const quarters = template.categories.find((c) => c.id === 'fedaykin-quarters');
      expect(quarters).toBeDefined();
      expect(quarters?.tierRestriction).toBe('fedaykin');
    });

    it('should have the-oasis category', () => {
      const template = theme.getChannelTemplate();
      const oasis = template.categories.find((c) => c.id === 'the-oasis');
      expect(oasis).toBeDefined();
    });

    it('should have cave-entrance category', () => {
      const template = theme.getChannelTemplate();
      const cave = template.categories.find((c) => c.id === 'cave-entrance');
      expect(cave).toBeDefined();
    });
  });

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  describe('utility methods', () => {
    describe('getTierById', () => {
      it('should return tier definition by ID', () => {
        const naib = theme.getTierById('naib');
        expect(naib).toBeDefined();
        expect(naib?.displayName).toBe('Naib');
      });

      it('should return undefined for unknown tier', () => {
        const unknown = theme.getTierById('unknown');
        expect(unknown).toBeUndefined();
      });
    });

    describe('getBadgeById', () => {
      it('should return badge definition by ID', () => {
        const waterSharer = theme.getBadgeById('water_sharer');
        expect(waterSharer).toBeDefined();
        expect(waterSharer?.displayName).toBe('Water Sharer');
      });

      it('should return undefined for unknown badge', () => {
        const unknown = theme.getBadgeById('unknown');
        expect(unknown).toBeUndefined();
      });
    });

    describe('getTierOrder', () => {
      it('should return tier IDs in order', () => {
        const order = theme.getTierOrder();
        expect(order[0]).toBe('naib');
        expect(order[1]).toBe('fedaykin');
        expect(order[8]).toBe('hajra');
      });
    });

    describe('isRankBasedTier', () => {
      it('should return true for naib', () => {
        expect(theme.isRankBasedTier('naib')).toBe(true);
      });

      it('should return true for fedaykin', () => {
        expect(theme.isRankBasedTier('fedaykin')).toBe(true);
      });

      it('should return false for usul', () => {
        expect(theme.isRankBasedTier('usul')).toBe(false);
      });

      it('should return false for hajra', () => {
        expect(theme.isRankBasedTier('hajra')).toBe(false);
      });
    });

    describe('getBgtThreshold', () => {
      it('should return null for rank-based tiers', () => {
        expect(theme.getBgtThreshold('naib')).toBeNull();
        expect(theme.getBgtThreshold('fedaykin')).toBeNull();
      });

      it('should return correct threshold for usul', () => {
        expect(theme.getBgtThreshold('usul')).toBe(1111);
      });

      it('should return correct threshold for hajra', () => {
        expect(theme.getBgtThreshold('hajra')).toBe(6.9);
      });
    });
  });

  // ===========================================================================
  // Factory Functions & Singleton
  // ===========================================================================

  describe('factory functions', () => {
    it('createSietchTheme should return SietchTheme instance', () => {
      const instance = createSietchTheme();
      expect(instance).toBeInstanceOf(SietchTheme);
      expect(instance.themeId).toBe('sietch');
    });

    it('sietchTheme singleton should be SietchTheme instance', () => {
      expect(sietchTheme).toBeInstanceOf(SietchTheme);
      expect(sietchTheme.themeId).toBe('sietch');
    });
  });

  // ===========================================================================
  // Constants Export
  // ===========================================================================

  describe('exported constants', () => {
    it('should export BGT_THRESHOLDS', () => {
      expect(BGT_THRESHOLDS.hajra).toBe(6.9);
      expect(BGT_THRESHOLDS.usul).toBe(1111);
    });

    it('should export RANK_BOUNDARIES', () => {
      expect(RANK_BOUNDARIES.naib.min).toBe(1);
      expect(RANK_BOUNDARIES.naib.max).toBe(7);
      expect(RANK_BOUNDARIES.fedaykin.min).toBe(8);
      expect(RANK_BOUNDARIES.fedaykin.max).toBe(69);
    });
  });
});

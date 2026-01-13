/**
 * BasicTheme Unit Tests
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Tests tier evaluation, badge evaluation, and configuration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BasicTheme, createBasicTheme, basicTheme } from '../../../../../src/packages/adapters/themes/BasicTheme.js';
import type { MemberContext } from '../../../../../src/packages/core/ports/IThemeProvider.js';

describe('BasicTheme', () => {
  let theme: BasicTheme;

  beforeEach(() => {
    theme = new BasicTheme();
  });

  describe('identity', () => {
    it('should have correct themeId', () => {
      expect(theme.themeId).toBe('basic');
    });

    it('should have correct themeName', () => {
      expect(theme.themeName).toBe('Basic');
    });

    it('should be free tier', () => {
      expect(theme.tier).toBe('free');
    });
  });

  describe('getTierConfig', () => {
    it('should return 3 tiers', () => {
      const config = theme.getTierConfig();
      expect(config.tiers).toHaveLength(3);
    });

    it('should have Gold, Silver, Bronze tiers', () => {
      const config = theme.getTierConfig();
      const tierIds = config.tiers.map((t) => t.id);
      expect(tierIds).toEqual(['gold', 'silver', 'bronze']);
    });

    it('should have Gold tier for ranks 1-10', () => {
      const config = theme.getTierConfig();
      const gold = config.tiers.find((t) => t.id === 'gold');
      expect(gold?.minRank).toBe(1);
      expect(gold?.maxRank).toBe(10);
    });

    it('should have Silver tier for ranks 11-50', () => {
      const config = theme.getTierConfig();
      const silver = config.tiers.find((t) => t.id === 'silver');
      expect(silver?.minRank).toBe(11);
      expect(silver?.maxRank).toBe(50);
    });

    it('should have Bronze tier for ranks 51-100', () => {
      const config = theme.getTierConfig();
      const bronze = config.tiers.find((t) => t.id === 'bronze');
      expect(bronze?.minRank).toBe(51);
      expect(bronze?.maxRank).toBe(100);
    });

    it('should use absolute ranking strategy', () => {
      const config = theme.getTierConfig();
      expect(config.rankingStrategy).toBe('absolute');
    });

    it('should have immediate demotion (grace period 0)', () => {
      const config = theme.getTierConfig();
      expect(config.demotionGracePeriod).toBe(0);
    });
  });

  describe('getBadgeConfig', () => {
    it('should return 5 badges', () => {
      const config = theme.getBadgeConfig();
      expect(config.badges).toHaveLength(5);
    });

    it('should have Early Adopter badge', () => {
      const config = theme.getBadgeConfig();
      const badge = config.badges.find((b) => b.id === 'early_adopter');
      expect(badge).toBeDefined();
      expect(badge?.displayName).toBe('Early Adopter');
      expect(badge?.criteria.type).toBe('tenure');
      expect(badge?.criteria.threshold).toBe(30);
    });

    it('should have Veteran badge', () => {
      const config = theme.getBadgeConfig();
      const badge = config.badges.find((b) => b.id === 'veteran');
      expect(badge).toBeDefined();
      expect(badge?.criteria.type).toBe('tenure');
      expect(badge?.criteria.threshold).toBe(90);
    });

    it('should have Top Tier badge', () => {
      const config = theme.getBadgeConfig();
      const badge = config.badges.find((b) => b.id === 'top_tier');
      expect(badge).toBeDefined();
      expect(badge?.criteria.type).toBe('tier_reached');
      expect(badge?.criteria.tierRequired).toBe('gold');
    });

    it('should have Active badge', () => {
      const config = theme.getBadgeConfig();
      const badge = config.badges.find((b) => b.id === 'active');
      expect(badge).toBeDefined();
      expect(badge?.criteria.type).toBe('activity');
      expect(badge?.criteria.threshold).toBe(50);
    });

    it('should have Contributor badge', () => {
      const config = theme.getBadgeConfig();
      const badge = config.badges.find((b) => b.id === 'contributor');
      expect(badge).toBeDefined();
      expect(badge?.criteria.type).toBe('custom');
    });

    it('should have all four categories', () => {
      const config = theme.getBadgeConfig();
      expect(config.categories).toContain('tenure');
      expect(config.categories).toContain('achievement');
      expect(config.categories).toContain('activity');
      expect(config.categories).toContain('special');
    });
  });

  describe('getNamingConfig', () => {
    it('should have generic naming template', () => {
      const config = theme.getNamingConfig();
      expect(config.serverNameTemplate).toBe('{community} Community');
    });

    it('should have standard category names', () => {
      const config = theme.getNamingConfig();
      expect(config.categoryNames.info).toBe('INFO');
      expect(config.categoryNames.council).toBe('LEADERSHIP');
      expect(config.categoryNames.general).toBe('GENERAL');
      expect(config.categoryNames.operations).toBe('BOT-OPS');
    });

    it('should have generic terminology', () => {
      const config = theme.getNamingConfig();
      expect(config.terminology.member).toBe('Member');
      expect(config.terminology.holder).toBe('Holder');
      expect(config.terminology.admin).toBe('Admin');
    });
  });

  describe('getChannelTemplate', () => {
    it('should return channel template with categories', () => {
      const template = theme.getChannelTemplate();
      expect(template.categories.length).toBeGreaterThan(0);
    });

    it('should have info category', () => {
      const template = theme.getChannelTemplate();
      const info = template.categories.find((c) => c.id === 'info');
      expect(info).toBeDefined();
      expect(info?.channels.length).toBeGreaterThan(0);
    });

    it('should have leadership category with tier restriction', () => {
      const template = theme.getChannelTemplate();
      const leadership = template.categories.find((c) => c.id === 'leadership');
      expect(leadership).toBeDefined();
      expect(leadership?.tierRestriction).toBe('gold');
    });
  });

  describe('evaluateTier', () => {
    it('should return Gold for rank 1', () => {
      const result = theme.evaluateTier(1);
      expect(result.tierId).toBe('gold');
      expect(result.tierName).toBe('Gold');
      expect(result.rankInTier).toBe(1);
    });

    it('should return Gold for rank 10', () => {
      const result = theme.evaluateTier(10);
      expect(result.tierId).toBe('gold');
      expect(result.rankInTier).toBe(10);
    });

    it('should return Silver for rank 11', () => {
      const result = theme.evaluateTier(11);
      expect(result.tierId).toBe('silver');
      expect(result.tierName).toBe('Silver');
      expect(result.rankInTier).toBe(1);
    });

    it('should return Silver for rank 50', () => {
      const result = theme.evaluateTier(50);
      expect(result.tierId).toBe('silver');
      expect(result.rankInTier).toBe(40);
    });

    it('should return Bronze for rank 51', () => {
      const result = theme.evaluateTier(51);
      expect(result.tierId).toBe('bronze');
      expect(result.tierName).toBe('Bronze');
      expect(result.rankInTier).toBe(1);
    });

    it('should return Bronze for rank 100', () => {
      const result = theme.evaluateTier(100);
      expect(result.tierId).toBe('bronze');
      expect(result.rankInTier).toBe(50);
    });

    it('should return Bronze for rank > 100', () => {
      const result = theme.evaluateTier(150);
      expect(result.tierId).toBe('bronze');
      expect(result.rankInTier).toBe(100);
    });

    it('should handle invalid rank < 1', () => {
      const result = theme.evaluateTier(0);
      expect(result.tierId).toBe('gold');
    });

    it('should return correct role colors', () => {
      expect(theme.evaluateTier(1).roleColor).toBe('#FFD700');
      expect(theme.evaluateTier(25).roleColor).toBe('#C0C0C0');
      expect(theme.evaluateTier(75).roleColor).toBe('#CD7F32');
    });
  });

  describe('evaluateBadges', () => {
    const createMemberContext = (overrides: Partial<MemberContext> = {}): MemberContext => ({
      address: '0x1234567890123456789012345678901234567890',
      rank: 50,
      currentTier: 'silver',
      convictionScore: 100,
      activityScore: 0,
      firstClaimAt: new Date('2024-01-01'),
      lastActivityAt: new Date(),
      tenureDays: 0,
      ...overrides,
    });

    it('should return empty array for new member', () => {
      const member = createMemberContext({
        tenureDays: 0,
        activityScore: 0,
      });
      const badges = theme.evaluateBadges(member);
      expect(badges).toHaveLength(0);
    });

    it('should award Early Adopter badge at 30 days', () => {
      const member = createMemberContext({ tenureDays: 30 });
      const badges = theme.evaluateBadges(member);
      const earlyAdopter = badges.find((b) => b.badgeId === 'early_adopter');
      expect(earlyAdopter).toBeDefined();
      expect(earlyAdopter?.emoji).toBe('🌟');
    });

    it('should award Veteran badge at 90 days', () => {
      const member = createMemberContext({ tenureDays: 90 });
      const badges = theme.evaluateBadges(member);
      const veteran = badges.find((b) => b.badgeId === 'veteran');
      expect(veteran).toBeDefined();
    });

    it('should award multiple tenure badges', () => {
      const member = createMemberContext({ tenureDays: 90 });
      const badges = theme.evaluateBadges(member);
      const badgeIds = badges.map((b) => b.badgeId);
      expect(badgeIds).toContain('early_adopter');
      expect(badgeIds).toContain('veteran');
    });

    it('should award Top Tier badge for Gold tier', () => {
      const member = createMemberContext({
        currentTier: 'gold',
        rank: 5,
      });
      const badges = theme.evaluateBadges(member);
      const topTier = badges.find((b) => b.badgeId === 'top_tier');
      expect(topTier).toBeDefined();
    });

    it('should award Top Tier badge for highest tier reached', () => {
      const member = createMemberContext({
        currentTier: 'silver',
        highestTier: 'gold',
      });
      const badges = theme.evaluateBadges(member);
      const topTier = badges.find((b) => b.badgeId === 'top_tier');
      expect(topTier).toBeDefined();
    });

    it('should award Active badge for activity score >= 50', () => {
      const member = createMemberContext({ activityScore: 50 });
      const badges = theme.evaluateBadges(member);
      const active = badges.find((b) => b.badgeId === 'active');
      expect(active).toBeDefined();
    });

    it('should not award Active badge for activity score < 50', () => {
      const member = createMemberContext({ activityScore: 49 });
      const badges = theme.evaluateBadges(member);
      const active = badges.find((b) => b.badgeId === 'active');
      expect(active).toBeUndefined();
    });

    it('should not award Contributor badge (custom evaluator)', () => {
      const member = createMemberContext({
        tenureDays: 365,
        activityScore: 100,
        currentTier: 'gold',
      });
      const badges = theme.evaluateBadges(member);
      const contributor = badges.find((b) => b.badgeId === 'contributor');
      expect(contributor).toBeUndefined();
    });

    it('should include earnedAt timestamp', () => {
      const member = createMemberContext({ tenureDays: 30 });
      const badges = theme.evaluateBadges(member);
      expect(badges[0]?.earnedAt).toBeInstanceOf(Date);
    });
  });

  describe('factory functions', () => {
    it('createBasicTheme should return BasicTheme instance', () => {
      const instance = createBasicTheme();
      expect(instance).toBeInstanceOf(BasicTheme);
    });

    it('basicTheme singleton should be BasicTheme instance', () => {
      expect(basicTheme).toBeInstanceOf(BasicTheme);
    });
  });
});

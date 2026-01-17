/**
 * Basic Theme Tests
 * Sprint S-17: Theme Interface & BasicTheme
 *
 * Tests for BasicTheme implementation including tier evaluation,
 * badge evaluation, and configuration.
 */

import { describe, it, expect } from 'vitest';
import { BasicTheme, basicTheme } from '../basic-theme.js';
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
  tierId: 'gold',
  joinedAt: new Date('2024-01-01'),
  joinPosition: 50,
  manualBadges: [],
  ...overrides,
});

const createMockHistory = (overrides: Partial<ProfileHistory> = {}): ProfileHistory => ({
  tenureDays: 100,
  daysSinceLastActivity: 1,
  activityStreakDays: 30,
  balanceEverDropped: false,
  marketDownturnsSurvived: 2,
  eventsAttended: 5,
  daysAtRankOrBetter: 50,
  referralCount: 3,
  tiersReached: ['bronze', 'silver', 'gold'],
  ...overrides,
});

// --------------------------------------------------------------------------
// Theme Properties Tests
// --------------------------------------------------------------------------

describe('BasicTheme Properties', () => {
  it('should have correct id', () => {
    const theme = new BasicTheme();
    expect(theme.id).toBe('basic');
  });

  it('should have correct name', () => {
    const theme = new BasicTheme();
    expect(theme.name).toBe('Basic Theme');
  });

  it('should have correct description', () => {
    const theme = new BasicTheme();
    expect(theme.description).toBe('Simple 3-tier progression with 5 badges');
  });

  it('should be free tier', () => {
    const theme = new BasicTheme();
    expect(theme.subscriptionTier).toBe('free');
  });
});

// --------------------------------------------------------------------------
// Singleton Tests
// --------------------------------------------------------------------------

describe('basicTheme Singleton', () => {
  it('should export singleton instance', () => {
    expect(basicTheme).toBeDefined();
    expect(basicTheme).toBeInstanceOf(BasicTheme);
  });

  it('should have same properties as new instance', () => {
    const theme = new BasicTheme();
    expect(basicTheme.id).toBe(theme.id);
    expect(basicTheme.name).toBe(theme.name);
  });
});

// --------------------------------------------------------------------------
// Tier Configuration Tests
// --------------------------------------------------------------------------

describe('BasicTheme Tier Configuration', () => {
  const theme = new BasicTheme();
  const tiers = theme.getTierConfig();

  it('should have 4 tiers (Gold, Silver, Bronze, Unranked)', () => {
    expect(tiers).toHaveLength(4);
  });

  it('should have Gold tier for ranks 1-10', () => {
    const gold = tiers.find((t) => t.id === 'gold');
    expect(gold).toBeDefined();
    expect(gold?.minRank).toBe(1);
    expect(gold?.maxRank).toBe(10);
    expect(gold?.roleColor).toBe(0xffd700);
    expect(gold?.permissions).toContain('view_analytics');
    expect(gold?.permissions).toContain('priority_support');
    expect(gold?.emoji).toBe('🥇');
  });

  it('should have Silver tier for ranks 11-50', () => {
    const silver = tiers.find((t) => t.id === 'silver');
    expect(silver).toBeDefined();
    expect(silver?.minRank).toBe(11);
    expect(silver?.maxRank).toBe(50);
    expect(silver?.roleColor).toBe(0xc0c0c0);
    expect(silver?.permissions).toContain('view_analytics');
    expect(silver?.emoji).toBe('🥈');
  });

  it('should have Bronze tier for ranks 51-100', () => {
    const bronze = tiers.find((t) => t.id === 'bronze');
    expect(bronze).toBeDefined();
    expect(bronze?.minRank).toBe(51);
    expect(bronze?.maxRank).toBe(100);
    expect(bronze?.roleColor).toBe(0xcd7f32);
    expect(bronze?.permissions).toHaveLength(0);
    expect(bronze?.emoji).toBe('🥉');
  });

  it('should have Unranked tier for ranks 101+', () => {
    const unranked = tiers.find((t) => t.id === 'unranked');
    expect(unranked).toBeDefined();
    expect(unranked?.minRank).toBe(101);
    expect(unranked?.permissions).toHaveLength(0);
  });

  it('should return new array each time (immutability)', () => {
    const tiers1 = theme.getTierConfig();
    const tiers2 = theme.getTierConfig();
    expect(tiers1).not.toBe(tiers2);
    expect(tiers1).toEqual(tiers2);
  });
});

// --------------------------------------------------------------------------
// Badge Configuration Tests
// --------------------------------------------------------------------------

describe('BasicTheme Badge Configuration', () => {
  const theme = new BasicTheme();
  const badges = theme.getBadgeConfig();

  it('should have 5 badges', () => {
    expect(badges).toHaveLength(5);
  });

  it('should have Early Adopter badge (join_order)', () => {
    const badge = badges.find((b) => b.id === 'early_adopter');
    expect(badge).toBeDefined();
    expect(badge?.evaluator).toBe('join_order');
    expect(badge?.parameters.maxPosition).toBe(100);
    expect(badge?.rarity).toBe('rare');
    expect(badge?.emoji).toBe('🌟');
  });

  it('should have Veteran badge (tenure)', () => {
    const badge = badges.find((b) => b.id === 'veteran');
    expect(badge).toBeDefined();
    expect(badge?.evaluator).toBe('tenure');
    expect(badge?.parameters.minDays).toBe(180);
    expect(badge?.rarity).toBe('uncommon');
    expect(badge?.emoji).toBe('🎖️');
  });

  it('should have Top Tier badge (tier_reached)', () => {
    const badge = badges.find((b) => b.id === 'top_tier');
    expect(badge).toBeDefined();
    expect(badge?.evaluator).toBe('tier_reached');
    expect(badge?.parameters.tierId).toBe('gold');
    expect(badge?.rarity).toBe('rare');
    expect(badge?.emoji).toBe('👑');
  });

  it('should have Active Member badge (recent_activity)', () => {
    const badge = badges.find((b) => b.id === 'active_member');
    expect(badge).toBeDefined();
    expect(badge?.evaluator).toBe('recent_activity');
    expect(badge?.parameters.maxDays).toBe(30);
    expect(badge?.rarity).toBe('common');
    expect(badge?.emoji).toBe('⚡');
  });

  it('should have Contributor badge (manual_grant)', () => {
    const badge = badges.find((b) => b.id === 'contributor');
    expect(badge).toBeDefined();
    expect(badge?.evaluator).toBe('manual_grant');
    expect(badge?.rarity).toBe('epic');
    expect(badge?.emoji).toBe('💎');
  });

  it('should return new array each time (immutability)', () => {
    const badges1 = theme.getBadgeConfig();
    const badges2 = theme.getBadgeConfig();
    expect(badges1).not.toBe(badges2);
    expect(badges1).toEqual(badges2);
  });
});

// --------------------------------------------------------------------------
// Naming Configuration Tests
// --------------------------------------------------------------------------

describe('BasicTheme Naming Configuration', () => {
  const theme = new BasicTheme();
  const naming = theme.getNamingConfig();

  it('should have tier prefix "Rank"', () => {
    expect(naming.tierPrefix).toBe('Rank');
  });

  it('should have empty tier suffix', () => {
    expect(naming.tierSuffix).toBe('');
  });

  it('should have community noun "Members"', () => {
    expect(naming.communityNoun).toBe('Members');
  });

  it('should have leaderboard title "Top Holders"', () => {
    expect(naming.leaderboardTitle).toBe('Top Holders');
  });

  it('should have score label "Score"', () => {
    expect(naming.scoreLabel).toBe('Score');
  });

  it('should return new object each time (immutability)', () => {
    const naming1 = theme.getNamingConfig();
    const naming2 = theme.getNamingConfig();
    expect(naming1).not.toBe(naming2);
    expect(naming1).toEqual(naming2);
  });
});

// --------------------------------------------------------------------------
// Tier Evaluation Tests
// --------------------------------------------------------------------------

describe('BasicTheme.evaluateTier', () => {
  const theme = new BasicTheme();

  it('should assign Gold tier for rank 1', () => {
    const result = theme.evaluateTier(5000, 1000, 1);
    expect(result.tier.id).toBe('gold');
    expect(result.score).toBe(5000);
    expect(result.rank).toBe(1);
  });

  it('should assign Gold tier for rank 10', () => {
    const result = theme.evaluateTier(3000, 1000, 10);
    expect(result.tier.id).toBe('gold');
  });

  it('should assign Silver tier for rank 11', () => {
    const result = theme.evaluateTier(2000, 1000, 11);
    expect(result.tier.id).toBe('silver');
  });

  it('should assign Silver tier for rank 50', () => {
    const result = theme.evaluateTier(1000, 1000, 50);
    expect(result.tier.id).toBe('silver');
  });

  it('should assign Bronze tier for rank 51', () => {
    const result = theme.evaluateTier(500, 1000, 51);
    expect(result.tier.id).toBe('bronze');
  });

  it('should assign Bronze tier for rank 100', () => {
    const result = theme.evaluateTier(100, 1000, 100);
    expect(result.tier.id).toBe('bronze');
  });

  it('should assign Unranked tier for rank 101', () => {
    const result = theme.evaluateTier(50, 1000, 101);
    expect(result.tier.id).toBe('unranked');
  });

  it('should assign Unranked tier for very high rank', () => {
    const result = theme.evaluateTier(1, 10000, 5000);
    expect(result.tier.id).toBe('unranked');
  });

  it('should calculate correct percentile for rank 1', () => {
    const result = theme.evaluateTier(5000, 1000, 1);
    expect(result.percentile).toBe(100);
  });

  it('should calculate correct percentile for rank 500', () => {
    const result = theme.evaluateTier(100, 1000, 500);
    // (1 - (500-1)/1000) * 100 = (1 - 0.499) * 100 = 50.1 → rounds to 50
    expect(result.percentile).toBe(50);
  });

  it('should calculate correct percentile for rank 1000', () => {
    const result = theme.evaluateTier(1, 1000, 1000);
    // (1 - (1000-1)/1000) * 100 = (1 - 0.999) * 100 = 0.1 → rounds to 0
    expect(result.percentile).toBe(0);
  });

  it('should handle zero total members', () => {
    const result = theme.evaluateTier(1000, 0, 1);
    expect(result.percentile).toBe(0);
  });

  it('should preserve score in result', () => {
    const result = theme.evaluateTier(12345, 1000, 5);
    expect(result.score).toBe(12345);
  });

  it('should preserve rank in result', () => {
    const result = theme.evaluateTier(1000, 1000, 42);
    expect(result.rank).toBe(42);
  });
});

// --------------------------------------------------------------------------
// Badge Evaluation Tests
// --------------------------------------------------------------------------

describe('BasicTheme.evaluateBadges', () => {
  const theme = new BasicTheme();

  it('should award Early Adopter badge to early members', () => {
    const profile = createMockProfile({ joinPosition: 50 });
    const history = createMockHistory();

    const badges = theme.evaluateBadges(profile, history);

    const earlyAdopter = badges.find((b) => b.badge.id === 'early_adopter');
    expect(earlyAdopter).toBeDefined();
  });

  it('should not award Early Adopter badge to late members', () => {
    const profile = createMockProfile({ joinPosition: 500 });
    const history = createMockHistory();

    const badges = theme.evaluateBadges(profile, history);

    const earlyAdopter = badges.find((b) => b.badge.id === 'early_adopter');
    expect(earlyAdopter).toBeUndefined();
  });

  it('should award Veteran badge to long-tenured members', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ tenureDays: 200 });

    const badges = theme.evaluateBadges(profile, history);

    const veteran = badges.find((b) => b.badge.id === 'veteran');
    expect(veteran).toBeDefined();
  });

  it('should not award Veteran badge to new members', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ tenureDays: 30 });

    const badges = theme.evaluateBadges(profile, history);

    const veteran = badges.find((b) => b.badge.id === 'veteran');
    expect(veteran).toBeUndefined();
  });

  it('should award Top Tier badge when in Gold tier', () => {
    const profile = createMockProfile({ tierId: 'gold' });
    const history = createMockHistory();

    const badges = theme.evaluateBadges(profile, history);

    const topTier = badges.find((b) => b.badge.id === 'top_tier');
    expect(topTier).toBeDefined();
  });

  it('should award Top Tier badge when Gold reached historically', () => {
    const profile = createMockProfile({ tierId: 'silver' });
    const history = createMockHistory({ tiersReached: ['bronze', 'silver', 'gold'] });

    const badges = theme.evaluateBadges(profile, history);

    const topTier = badges.find((b) => b.badge.id === 'top_tier');
    expect(topTier).toBeDefined();
  });

  it('should not award Top Tier badge if never reached Gold', () => {
    const profile = createMockProfile({ tierId: 'bronze' });
    const history = createMockHistory({ tiersReached: ['bronze'] });

    const badges = theme.evaluateBadges(profile, history);

    const topTier = badges.find((b) => b.badge.id === 'top_tier');
    expect(topTier).toBeUndefined();
  });

  it('should award Active Member badge to recently active', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ daysSinceLastActivity: 5 });

    const badges = theme.evaluateBadges(profile, history);

    const active = badges.find((b) => b.badge.id === 'active_member');
    expect(active).toBeDefined();
  });

  it('should not award Active Member badge to inactive', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ daysSinceLastActivity: 60 });

    const badges = theme.evaluateBadges(profile, history);

    const active = badges.find((b) => b.badge.id === 'active_member');
    expect(active).toBeUndefined();
  });

  it('should award Contributor badge when manually granted', () => {
    const profile = createMockProfile({ manualBadges: ['contributor'] });
    const history = createMockHistory();

    const badges = theme.evaluateBadges(profile, history);

    const contributor = badges.find((b) => b.badge.id === 'contributor');
    expect(contributor).toBeDefined();
  });

  it('should not award Contributor badge when not granted', () => {
    const profile = createMockProfile({ manualBadges: [] });
    const history = createMockHistory();

    const badges = theme.evaluateBadges(profile, history);

    const contributor = badges.find((b) => b.badge.id === 'contributor');
    expect(contributor).toBeUndefined();
  });

  it('should award multiple badges when earned', () => {
    const profile = createMockProfile({
      joinPosition: 10,
      tierId: 'gold',
      manualBadges: ['contributor'],
    });
    const history = createMockHistory({
      tenureDays: 200,
      daysSinceLastActivity: 1,
      tiersReached: ['gold'],
    });

    const badges = theme.evaluateBadges(profile, history);

    expect(badges.length).toBe(5); // All 5 badges earned
  });

  it('should return empty array when no badges earned', () => {
    const profile = createMockProfile({
      joinPosition: 500,
      tierId: 'bronze',
      manualBadges: [],
    });
    const history = createMockHistory({
      tenureDays: 10,
      daysSinceLastActivity: 60,
      tiersReached: ['bronze'],
    });

    const badges = theme.evaluateBadges(profile, history);

    expect(badges.length).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Theme Validation Tests
// --------------------------------------------------------------------------

describe('BasicTheme Validation', () => {
  it('should pass theme validation', () => {
    const theme = new BasicTheme();
    const result = validateTheme(theme);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should have non-overlapping tier ranges', () => {
    const theme = new BasicTheme();
    const tiers = theme.getTierConfig();

    // Sort by minRank
    const sorted = [...tiers].sort((a, b) => a.minRank - b.minRank);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      expect(current.maxRank).toBeLessThan(next.minRank);
    }
  });

  it('should have unique tier IDs', () => {
    const theme = new BasicTheme();
    const tiers = theme.getTierConfig();
    const ids = tiers.map((t) => t.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have unique badge IDs', () => {
    const theme = new BasicTheme();
    const badges = theme.getBadgeConfig();
    const ids = badges.map((b) => b.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });
});

// --------------------------------------------------------------------------
// SDD Compliance Tests (§6.2.3)
// --------------------------------------------------------------------------

describe('BasicTheme SDD §6.2.3 Compliance', () => {
  const theme = new BasicTheme();

  it('should be free tier per SDD', () => {
    expect(theme.subscriptionTier).toBe('free');
  });

  it('should have 3 display tiers + unranked per SDD', () => {
    const tiers = theme.getTierConfig();
    expect(tiers.filter((t) => t.id !== 'unranked')).toHaveLength(3);
  });

  it('should have Gold tier with view_analytics + priority_support per SDD', () => {
    const tiers = theme.getTierConfig();
    const gold = tiers.find((t) => t.id === 'gold');
    expect(gold?.permissions).toContain('view_analytics');
    expect(gold?.permissions).toContain('priority_support');
  });

  it('should have Silver tier with view_analytics only per SDD', () => {
    const tiers = theme.getTierConfig();
    const silver = tiers.find((t) => t.id === 'silver');
    expect(silver?.permissions).toEqual(['view_analytics']);
  });

  it('should have Bronze tier with no permissions per SDD', () => {
    const tiers = theme.getTierConfig();
    const bronze = tiers.find((t) => t.id === 'bronze');
    expect(bronze?.permissions).toEqual([]);
  });

  it('should have 5 badges per SDD', () => {
    const badges = theme.getBadgeConfig();
    expect(badges).toHaveLength(5);
  });

  it('should have correct badge evaluator types per SDD', () => {
    const badges = theme.getBadgeConfig();

    expect(badges.find((b) => b.id === 'early_adopter')?.evaluator).toBe('join_order');
    expect(badges.find((b) => b.id === 'veteran')?.evaluator).toBe('tenure');
    expect(badges.find((b) => b.id === 'top_tier')?.evaluator).toBe('tier_reached');
    expect(badges.find((b) => b.id === 'active_member')?.evaluator).toBe('recent_activity');
    expect(badges.find((b) => b.id === 'contributor')?.evaluator).toBe('manual_grant');
  });
});

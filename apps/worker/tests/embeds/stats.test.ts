/**
 * Stats Embed Tests
 */

import { describe, it, expect } from 'vitest';
import { buildPersonalStatsEmbed, type PersonalStatsData } from '../../src/embeds/stats.js';
import { Colors } from '../../src/embeds/common.js';

describe('buildPersonalStatsEmbed', () => {
  const baseStats: PersonalStatsData = {
    nym: 'TestUser',
    tier: 'fedaykin',
    tenureCategory: 'veteran',
    memberSince: new Date('2023-06-15'),
    badgeCount: 5,
    messagesThisWeek: 42,
    currentStreak: 7,
    longestStreak: 14,
    badges: [
      { name: 'Early Bird', emoji: '\u{1F426}' },
      { name: 'Top Contributor' },
    ],
    tierProgress: {
      nextTier: 'naib',
      isRankBased: true,
    },
  };

  it('should create embed with correct title', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    expect(embed.title).toContain('TestUser');
    expect(embed.title).toContain('Stats');
  });

  it('should use blue color', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    expect(embed.color).toBe(Colors.BLUE);
  });

  it('should include tier field', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const tierField = embed.fields?.find((f) => f.name.includes('Tier'));
    expect(tierField).toBeDefined();
    expect(tierField?.value).toContain('Fedaykin');
  });

  it('should include tenure field', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const tenureField = embed.fields?.find((f) => f.name.includes('Tenure'));
    expect(tenureField).toBeDefined();
    expect(tenureField?.value).toContain('Veteran');
  });

  it('should include badge count', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const badgeField = embed.fields?.find((f) => f.name.includes('Badges'));
    expect(badgeField).toBeDefined();
    expect(badgeField?.value).toContain('5');
  });

  it('should include activity this week', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const activityField = embed.fields?.find((f) => f.name.includes('Activity'));
    expect(activityField).toBeDefined();
    expect(activityField?.value).toContain('42');
  });

  it('should include streak information', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const currentStreakField = embed.fields?.find((f) => f.name.includes('Current Streak'));
    const longestStreakField = embed.fields?.find((f) => f.name.includes('Longest Streak'));
    expect(currentStreakField?.value).toContain('7');
    expect(longestStreakField?.value).toContain('14');
  });

  it('should include recent badges when available', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const recentBadgesField = embed.fields?.find((f) => f.name.includes('Recent Badges'));
    expect(recentBadgesField).toBeDefined();
    expect(recentBadgesField?.value).toContain('Early Bird');
  });

  it('should not show recent badges field if no badges', () => {
    const statsNoBadges = { ...baseStats, badges: [], badgeCount: 0 };
    const embed = buildPersonalStatsEmbed(statsNoBadges);
    const recentBadgesField = embed.fields?.find((f) => f.name.includes('Recent Badges'));
    expect(recentBadgesField).toBeUndefined();
  });

  it('should show tier progress when next tier exists', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    const tierField = embed.fields?.find((f) => f.name.includes('Tier'));
    expect(tierField?.value).toContain('Naib');
    expect(tierField?.value).toContain('rank-based');
  });

  it('should show max tier message when at highest tier', () => {
    const maxTierStats = {
      ...baseStats,
      tier: 'naib',
      tierProgress: { nextTier: null, isRankBased: false },
    };
    const embed = buildPersonalStatsEmbed(maxTierStats);
    const tierField = embed.fields?.find((f) => f.name.includes('Tier'));
    expect(tierField?.value).toContain('maximum tier');
  });

  it('should include thumbnail when pfpUrl provided', () => {
    const statsWithPfp = { ...baseStats, pfpUrl: 'https://example.com/avatar.png' };
    const embed = buildPersonalStatsEmbed(statsWithPfp);
    expect(embed.thumbnail?.url).toBe('https://example.com/avatar.png');
  });

  it('should include privacy footer', () => {
    const embed = buildPersonalStatsEmbed(baseStats);
    expect(embed.footer?.text).toContain('private');
  });
});

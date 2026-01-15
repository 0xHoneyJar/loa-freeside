/**
 * Leaderboard Embed Tests
 */

import { describe, it, expect } from 'vitest';
import {
  buildBadgeLeaderboardEmbed,
  buildTierProgressionEmbed,
} from '../../src/embeds/leaderboard.js';
import type { BadgeLeaderboardEntry, TierProgressionEntry } from '../../src/data/index.js';

describe('buildBadgeLeaderboardEmbed', () => {
  const mockEntries: BadgeLeaderboardEntry[] = [
    {
      rank: 1,
      profileId: 'profile-1',
      discordId: 'user-1',
      badgeCount: 15,
      tier: 'naib',
      tenureCategory: 'og',
      nym: 'TopUser',
      joinedAt: new Date('2024-01-01'),
    },
    {
      rank: 2,
      profileId: 'profile-2',
      discordId: 'user-2',
      badgeCount: 12,
      tier: 'fedaykin',
      tenureCategory: 'veteran',
      nym: 'SecondUser',
      joinedAt: new Date('2024-02-01'),
    },
    {
      rank: 3,
      profileId: 'profile-3',
      discordId: 'user-3',
      badgeCount: 10,
      tier: 'fedaykin',
      tenureCategory: 'member',
      nym: 'ThirdUser',
      joinedAt: new Date('2024-03-01'),
    },
  ];

  it('should create embed with correct title', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.title).toContain('Engagement Leaderboard');
    expect(embed.title).toContain('🏆');
  });

  it('should show medal emojis for top 3', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.description).toContain('🥇');
    expect(embed.description).toContain('🥈');
    expect(embed.description).toContain('🥉');
  });

  it('should show user names and badge counts', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.description).toContain('**TopUser**');
    expect(embed.description).toContain('15 badges');
    expect(embed.description).toContain('**SecondUser**');
    expect(embed.description).toContain('12 badges');
  });

  it('should include tier emojis', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.description).toContain('👑'); // naib
    expect(embed.description).toContain('⚔️'); // fedaykin
  });

  it('should include tenure emojis', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.description).toContain('🏛️'); // og
    expect(embed.description).toContain('⭐'); // veteran
    expect(embed.description).toContain('🌱'); // member
  });

  it('should show total members in footer', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.footer?.text).toContain('100 total members');
  });

  it('should show user position when not in top list', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100, 25);

    expect(embed.fields).toBeDefined();
    expect(embed.fields?.length).toBeGreaterThan(0);
    expect(embed.fields?.[0]?.name).toBe('Your Position');
    expect(embed.fields?.[0]?.value).toContain('#25');
  });

  it('should NOT show user position field when in top list', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100, 2);

    // Should not have fields when user is in top list
    expect(embed.fields?.find((f) => f.name === 'Your Position')).toBeUndefined();
  });

  it('should handle empty leaderboard', () => {
    const embed = buildBadgeLeaderboardEmbed([], 0);

    expect(embed.description).toContain('No leaderboard data available');
  });

  it('should handle null userRank', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100, null);

    // Should not have Your Position field
    expect(embed.fields?.find((f) => f.name === 'Your Position')).toBeUndefined();
  });

  it('should include timestamp', () => {
    const embed = buildBadgeLeaderboardEmbed(mockEntries, 100);

    expect(embed.timestamp).toBeDefined();
  });
});

describe('buildTierProgressionEmbed', () => {
  const mockEntries: TierProgressionEntry[] = [
    {
      rank: 1,
      profileId: 'profile-1',
      discordId: 'user-1',
      nym: 'ClosestUser',
      currentTier: 'sietch',
      nextTier: 'sayyadina',
      convictionScore: 900,
      distanceToNextTier: 100,
    },
    {
      rank: 2,
      profileId: 'profile-2',
      discordId: 'user-2',
      nym: 'SecondClosest',
      currentTier: 'stillsuit',
      nextTier: 'sietch',
      convictionScore: 400,
      distanceToNextTier: 100,
    },
    {
      rank: 3,
      profileId: 'profile-3',
      discordId: 'user-3',
      nym: 'ThirdClosest',
      currentTier: 'fremen',
      nextTier: 'stillsuit',
      convictionScore: 50,
      distanceToNextTier: 50,
    },
  ];

  it('should create embed with correct title', () => {
    const embed = buildTierProgressionEmbed(mockEntries);

    expect(embed.title).toContain('Tier Progression Leaderboard');
    expect(embed.title).toContain('🏆');
  });

  it('should show tier progression info', () => {
    const embed = buildTierProgressionEmbed(mockEntries);

    // Check fields contain progression info
    const topField = embed.fields?.find((f) => f.name === 'Top Progressors');
    expect(topField).toBeDefined();
    expect(topField?.value).toContain('Sietch');
    expect(topField?.value).toContain('Sayyadina');
    expect(topField?.value).toContain('100 BGT away');
  });

  it('should show user names', () => {
    const embed = buildTierProgressionEmbed(mockEntries);

    const topField = embed.fields?.find((f) => f.name === 'Top Progressors');
    expect(topField?.value).toContain('**ClosestUser**');
    expect(topField?.value).toContain('**SecondClosest**');
  });

  it('should show medal emojis', () => {
    const embed = buildTierProgressionEmbed(mockEntries);

    const topField = embed.fields?.find((f) => f.name === 'Top Progressors');
    expect(topField?.value).toContain('🥇');
    expect(topField?.value).toContain('🥈');
    expect(topField?.value).toContain('🥉');
  });

  it('should show user entry when not in top list', () => {
    const userEntry: TierProgressionEntry = {
      rank: 25,
      profileId: 'profile-user',
      discordId: 'user-current',
      nym: 'CurrentUser',
      currentTier: 'fremen',
      nextTier: 'stillsuit',
      convictionScore: 10,
      distanceToNextTier: 90,
    };

    const embed = buildTierProgressionEmbed(mockEntries, userEntry);

    const userField = embed.fields?.find((f) => f.name === 'Your Position');
    expect(userField).toBeDefined();
    expect(userField?.value).toContain('Rank 25');
    expect(userField?.value).toContain('Fremen');
    expect(userField?.value).toContain('Stillsuit');
  });

  it('should NOT show user entry when already in top list', () => {
    const userEntry: TierProgressionEntry = {
      rank: 1,
      profileId: 'profile-1', // Same as first entry
      discordId: 'user-1',
      nym: 'ClosestUser',
      currentTier: 'sietch',
      nextTier: 'sayyadina',
      convictionScore: 900,
      distanceToNextTier: 100,
    };

    const embed = buildTierProgressionEmbed(mockEntries, userEntry);

    const userField = embed.fields?.find((f) => f.name === 'Your Position');
    expect(userField).toBeUndefined();
  });

  it('should handle empty entries', () => {
    const embed = buildTierProgressionEmbed([]);

    expect(embed.description).toContain('No tier progression data available');
    expect(embed.description).toContain('Fedaykin and Naib');
  });

  it('should include footer with privacy note', () => {
    const embed = buildTierProgressionEmbed(mockEntries);

    expect(embed.footer?.text).toContain('rank-based tiers');
    expect(embed.footer?.text).toContain('BGT values rounded');
  });

  it('should include timestamp', () => {
    const embed = buildTierProgressionEmbed(mockEntries);

    expect(embed.timestamp).toBeDefined();
  });
});

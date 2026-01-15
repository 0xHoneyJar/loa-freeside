/**
 * Profile Embed Builder
 *
 * Creates Discord embeds for profile display.
 * Privacy-conscious: never exposes wallet addresses or Discord IDs.
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type { OwnProfile, PublicProfile } from '../data/index.js';

/**
 * Tier configuration
 */
const TIER_CONFIG: Record<string, { color: number; emoji: string; title: string }> = {
  naib: { color: Colors.GOLD, emoji: '👑', title: 'Naib' },
  fedaykin: { color: Colors.BLUE, emoji: '⚔️', title: 'Fedaykin' },
};

/**
 * Tenure display
 */
const TENURE_DISPLAY: Record<string, { emoji: string; label: string }> = {
  og: { emoji: '🏛️', label: 'OG (1+ year)' },
  veteran: { emoji: '🎖️', label: 'Veteran (6+ months)' },
  elder: { emoji: '📜', label: 'Elder (3+ months)' },
  member: { emoji: '🌱', label: 'Member' },
};

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Default tier config
 */
const DEFAULT_TIER_CONFIG = { color: Colors.BLUE, emoji: '⚔️', title: 'Fedaykin' };

/**
 * Build own profile embed (full view for profile owner)
 */
export function buildOwnProfileEmbed(profile: OwnProfile): DiscordEmbed {
  const tier = profile.tier ?? 'fedaykin';
  const tierConfig = TIER_CONFIG[tier] ?? DEFAULT_TIER_CONFIG;

  const fields = [
    { name: 'Tier', value: tierConfig.title, inline: true },
    { name: 'Member Since', value: formatDate(profile.createdAt), inline: true },
    {
      name: 'Onboarding',
      value: profile.onboardingComplete ? '✅ Complete' : '⏳ In Progress',
      inline: true,
    },
  ];

  // Nym change info
  if (profile.nymLastChanged) {
    fields.push({
      name: 'Nym Changed',
      value: formatDate(profile.nymLastChanged),
      inline: true,
    });
  }

  return createEmbed({
    title: `${tierConfig.emoji} ${profile.nym}`,
    description: profile.bio ?? undefined,
    color: tierConfig.color,
    thumbnail: profile.pfpUrl ?? undefined,
    fields,
    footer: 'Use /profile edit to update your profile',
    timestamp: true,
  });
}

/**
 * Default tenure display
 */
const DEFAULT_TENURE_DISPLAY = { emoji: '🌱', label: 'Member' };

/**
 * Build public profile embed (privacy-filtered view)
 */
export function buildPublicProfileEmbed(profile: PublicProfile): DiscordEmbed {
  const tier = profile.tier ?? 'fedaykin';
  const tierConfig = TIER_CONFIG[tier] ?? DEFAULT_TIER_CONFIG;
  const tenureInfo = TENURE_DISPLAY[profile.tenureCategory] ?? DEFAULT_TENURE_DISPLAY;

  const fields = [
    { name: 'Tier', value: tierConfig.title, inline: true },
    { name: 'Tenure', value: `${tenureInfo.emoji} ${tenureInfo.label}`, inline: true },
    { name: 'Badges', value: `${profile.badgeCount} earned`, inline: true },
  ];

  // Badge list if they have any
  if (profile.badges.length > 0) {
    const badgeList = profile.badges
      .map((b) => `${b.emoji ?? '🏅'} ${b.name}`)
      .join(' • ');

    const moreText = profile.badgeCount > 5 ? ` (+${profile.badgeCount - 5} more)` : '';

    fields.push({
      name: 'Recent Badges',
      value: badgeList + moreText,
      inline: false,
    });
  }

  return createEmbed({
    title: `${tierConfig.emoji} ${profile.nym}`,
    description: profile.bio ?? undefined,
    color: tierConfig.color,
    thumbnail: profile.pfpUrl ?? undefined,
    fields,
    footer: 'Sietch protects member privacy • No wallet addresses shown',
    timestamp: true,
  });
}

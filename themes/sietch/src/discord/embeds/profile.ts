import { EmbedBuilder, type ColorResolvable } from 'discord.js';
import type { MemberProfile, PublicProfile, PublicBadge } from '../../types/index.js';

/**
 * Embed colors for Sietch
 */
const COLORS = {
  GOLD: 0xf5a623 as ColorResolvable, // Naib / Premium
  BLUE: 0x3498db as ColorResolvable, // Fedaykin / Standard
  GREEN: 0x2ecc71 as ColorResolvable, // Success
  GRAY: 0x95a5a6 as ColorResolvable, // Neutral
};

/**
 * Tier display configuration
 */
const TIER_CONFIG = {
  naib: {
    color: COLORS.GOLD,
    emoji: '👑',
    title: 'Naib',
    description: 'Member of the Council',
  },
  fedaykin: {
    color: COLORS.BLUE,
    emoji: '⚔️',
    title: 'Fedaykin',
    description: 'Desert Warrior',
  },
};

/**
 * Tenure category display
 */
const TENURE_DISPLAY = {
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
 * Format badges for display
 */
function formatBadges(badges: PublicBadge[]): string {
  if (!badges || badges.length === 0) {
    return '*No badges yet*';
  }

  return badges
    .map((badge) => `${badge.emoji ?? '🏅'} ${badge.name}`)
    .join('\n');
}

/**
 * Group badges by category for display
 */
function groupBadgesByCategory(badges: PublicBadge[]): Map<string, PublicBadge[]> {
  const grouped = new Map<string, PublicBadge[]>();

  for (const badge of badges) {
    const category = badge.category;
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(badge);
  }

  return grouped;
}

/**
 * Build own profile embed (full view for profile owner)
 */
export function buildOwnProfileEmbed(profile: MemberProfile): EmbedBuilder {
  const tierConfig = TIER_CONFIG[profile.tier];

  const embed = new EmbedBuilder()
    .setTitle(`${tierConfig.emoji} ${profile.nym}`)
    .setColor(tierConfig.color)
    .setTimestamp();

  // Profile picture
  if (profile.pfpUrl) {
    embed.setThumbnail(profile.pfpUrl);
  }

  // Bio
  if (profile.bio) {
    embed.setDescription(profile.bio);
  }

  // Main fields
  embed.addFields(
    { name: 'Tier', value: tierConfig.title, inline: true },
    { name: 'Member Since', value: formatDate(profile.createdAt), inline: true },
    { name: 'Onboarding', value: profile.onboardingComplete ? '✅ Complete' : '⏳ In Progress', inline: true }
  );

  // Nym change info
  if (profile.nymLastChanged) {
    embed.addFields({
      name: 'Nym Changed',
      value: formatDate(profile.nymLastChanged),
      inline: true,
    });
  }

  // Footer
  embed.setFooter({
    text: 'Use /profile edit to update your profile',
  });

  return embed;
}

/**
 * Build public profile embed (privacy-filtered view)
 */
export function buildPublicProfileEmbed(profile: PublicProfile): EmbedBuilder {
  const tierConfig = TIER_CONFIG[profile.tier];
  const tenureInfo = TENURE_DISPLAY[profile.tenureCategory];

  const embed = new EmbedBuilder()
    .setTitle(`${tierConfig.emoji} ${profile.nym}`)
    .setColor(tierConfig.color)
    .setTimestamp();

  // Profile picture
  if (profile.pfpUrl) {
    embed.setThumbnail(profile.pfpUrl);
  }

  // Bio
  if (profile.bio) {
    embed.setDescription(profile.bio);
  }

  // Main fields
  embed.addFields(
    { name: 'Tier', value: tierConfig.title, inline: true },
    { name: 'Tenure', value: `${tenureInfo.emoji} ${tenureInfo.label}`, inline: true },
    { name: 'Badges', value: `${profile.badgeCount} earned`, inline: true }
  );

  // Badge list if they have any
  if (profile.badges && profile.badges.length > 0) {
    const badgeList = profile.badges
      .slice(0, 5) // Show max 5 badges
      .map((b) => `${b.emoji ?? '🏅'} ${b.name}`)
      .join(' • ');

    const moreText = profile.badges.length > 5
      ? ` (+${profile.badges.length - 5} more)`
      : '';

    embed.addFields({
      name: 'Recent Badges',
      value: badgeList + moreText,
      inline: false,
    });
  }

  // Footer with privacy note
  embed.setFooter({
    text: 'Sietch protects member privacy • No wallet addresses shown',
  });

  return embed;
}

/**
 * Build profile card embed (compact version for directory)
 */
export function buildProfileCardEmbed(profile: PublicProfile): EmbedBuilder {
  const tierConfig = TIER_CONFIG[profile.tier];
  const tenureInfo = TENURE_DISPLAY[profile.tenureCategory];

  const embed = new EmbedBuilder()
    .setColor(tierConfig.color)
    .setAuthor({
      name: `${tierConfig.emoji} ${profile.nym}`,
      iconURL: profile.pfpUrl ?? undefined,
    })
    .addFields(
      { name: 'Tier', value: tierConfig.title, inline: true },
      { name: 'Tenure', value: tenureInfo.label, inline: true },
      { name: 'Badges', value: String(profile.badgeCount), inline: true }
    );

  return embed;
}

/**
 * Build welcome embed for onboarding
 */
export function buildWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Welcome to Sietch!')
    .setDescription(
      `You've gained access to our exclusive community for top BGT holders.\n\n` +
      `Let's set up your **pseudonymous profile**. Your privacy is important to us:\n\n` +
      `🔒 **Privacy Assurances:**\n` +
      `• Your wallet address is **never** shared with other members\n` +
      `• Your Discord identity is **not** linked to your nym\n` +
      `• Only you can see your own activity stats\n\n` +
      `Let's begin by choosing your **nym** (pseudonymous name).`
    )
    .setColor(COLORS.GREEN)
    .setFooter({ text: 'Step 1 of 3 • Choose your Nym' });
}

/**
 * Build PFP selection embed
 */
export function buildPfpSelectionEmbed(nym: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Profile Picture')
    .setDescription(
      `Great choice, **${nym}**!\n\n` +
      `Now let's set up your profile picture.\n\n` +
      `You can:\n` +
      `📸 **Upload** your own image\n` +
      `🎨 **Generate** a unique avatar from your member ID\n` +
      `⏭️ **Skip** for now (you can add one later)\n`
    )
    .setColor(COLORS.BLUE)
    .setFooter({ text: 'Step 2 of 3 • Profile Picture' });
}

/**
 * Build bio prompt embed
 */
export function buildBioPromptEmbed(nym: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Add a Bio')
    .setDescription(
      `Almost done, **${nym}**!\n\n` +
      `Would you like to add a short bio? This will be visible on your profile.\n\n` +
      `📝 Keep it under 160 characters\n` +
      `🔗 URLs will be automatically removed for privacy\n`
    )
    .setColor(COLORS.BLUE)
    .setFooter({ text: 'Step 3 of 3 • Bio (Optional)' });
}

/**
 * Build onboarding complete embed
 */
export function buildOnboardingCompleteEmbed(
  nym: string,
  tier: 'naib' | 'fedaykin',
  becameNaib: boolean = false
): EmbedBuilder {
  const tierConfig = TIER_CONFIG[tier];

  // Special message for new Naib members
  if (becameNaib) {
    return new EmbedBuilder()
      .setTitle('👑 Welcome to the Naib Council!')
      .setDescription(
        `Your profile is ready, **${nym}**!\n\n` +
        `You've claimed a seat on the **Naib Council** as one of the top 7 BGT holders!\n\n` +
        `**Your Privileges:**\n` +
        `• Access to exclusive Naib Council channels\n` +
        `• Founding Naib recognition if among the first 7\n` +
        `• Voting rights on community decisions\n\n` +
        `**What's Next:**\n` +
        `• Use \`/naib\` to see your fellow council members\n` +
        `• Use \`/profile\` to view your profile\n` +
        `• Defend your seat by maintaining your BGT holdings!\n`
      )
      .setColor(COLORS.GOLD)
      .setFooter({ text: 'May your reign be prosperous!' });
  }

  return new EmbedBuilder()
    .setTitle('🎉 Welcome to Sietch!')
    .setDescription(
      `Your profile is ready, **${nym}**!\n\n` +
      `You've joined as a **${tierConfig.title}** ${tierConfig.emoji}\n\n` +
      `**What's Next:**\n` +
      `• Explore channels and meet other members\n` +
      `• Earn badges through participation\n` +
      `• Use \`/profile\` to view your profile\n` +
      `• Use \`/profile edit\` to make changes\n`
    )
    .setColor(COLORS.GREEN)
    .setFooter({ text: 'May the spice flow!' });
}

/**
 * Build edit wizard start embed
 */
export function buildEditWizardEmbed(profile: MemberProfile): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Edit Your Profile')
    .setDescription(
      `What would you like to change?\n\n` +
      `**Current Profile:**\n` +
      `• Nym: \`${profile.nym}\`\n` +
      `• Bio: ${profile.bio ?? '*Not set*'}\n` +
      `• PFP: ${profile.pfpType === 'custom' ? 'Custom' : profile.pfpType === 'generated' ? 'Generated' : 'None'}\n`
    )
    .setColor(COLORS.BLUE)
    .setFooter({ text: 'Select an option below' });
}

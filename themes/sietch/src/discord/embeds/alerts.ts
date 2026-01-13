/**
 * Alert Embeds
 *
 * Discord embeds for notification alerts.
 * Each alert type has its own styled embed.
 *
 * Colors:
 * - Position Update: Blue (#4169E1) - Information
 * - At-Risk Warning: Orange (#FF8C00) - Warning
 * - Naib Threat: Red (#DC143C) - Urgent
 * - Naib Bump: Purple (#8B008B) - Transition
 * - Naib Seated: Gold (#FFD700) - Celebration
 * - Waitlist Eligible: Green (#228B22) - Success
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type {
  AlertType,
  AlertData,
  PositionUpdateAlertData,
  AtRiskWarningAlertData,
  NaibThreatAlertData,
  NaibBumpAlertData,
  NaibSeatedAlertData,
  WaitlistEligibleAlertData,
  TierPromotionAlertData,
  BadgeAwardAlertData,
} from '../../types/index.js';

/**
 * Alert colors by type
 */
const ALERT_COLORS: Record<AlertType, number> = {
  position_update: 0x4169e1,  // Royal Blue
  at_risk_warning: 0xff8c00,  // Dark Orange
  naib_threat: 0xdc143c,      // Crimson
  naib_bump: 0x8b008b,        // Dark Magenta
  naib_seated: 0xffd700,      // Gold
  waitlist_eligible: 0x228b22, // Forest Green
  tier_promotion: 0x9b59b6,   // Purple - Celebration (Sprint 18)
  badge_award: 0x00d4ff,      // Aqua - Badge (Sprint 18)
};

/**
 * Format BGT amount for display
 */
function formatBgt(amount: number): string {
  if (amount >= 1000) {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (amount >= 1) {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return amount.toFixed(6);
}

/**
 * Build an alert embed based on type and data
 */
export function buildAlertEmbed(alertType: AlertType, data: AlertData): EmbedBuilder {
  switch (alertType) {
    case 'position_update':
      return buildPositionUpdateEmbed(data as PositionUpdateAlertData);
    case 'at_risk_warning':
      return buildAtRiskWarningEmbed(data as AtRiskWarningAlertData);
    case 'naib_threat':
      return buildNaibThreatEmbed(data as NaibThreatAlertData);
    case 'naib_bump':
      return buildNaibBumpEmbed(data as NaibBumpAlertData);
    case 'naib_seated':
      return buildNaibSeatedEmbed(data as NaibSeatedAlertData);
    case 'waitlist_eligible':
      return buildWaitlistEligibleEmbed(data as WaitlistEligibleAlertData);
    case 'tier_promotion':
      return buildTierPromotionEmbed(data as TierPromotionAlertData);
    case 'badge_award':
      return buildBadgeAwardAlertEmbed(data as BadgeAwardAlertData);
    default:
      throw new Error(`Unknown alert type: ${alertType}`);
  }
}

/**
 * Position Update Embed
 * Regular position distance notification
 */
function buildPositionUpdateEmbed(data: PositionUpdateAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📊 Position Update')
    .setColor(ALERT_COLORS.position_update)
    .setTimestamp();

  // Role indicator
  let roleText = '';
  if (data.isNaib) {
    roleText = '👑 **Naib** (Top 7)';
  } else if (data.isFedaykin) {
    roleText = '⚔️ **Fedaykin** (Eligible)';
  } else {
    roleText = '⏳ **Waiting Pool**';
  }

  embed.setDescription(
    `Your current standing in the Sietch hierarchy.\n\n` +
    `${roleText}`
  );

  // Current position
  embed.addFields({
    name: '📍 Your Position',
    value: `**#${data.position}**\n${formatBgt(data.bgt)} BGT`,
    inline: true,
  });

  // Distance to above
  if (data.distanceToAbove !== null) {
    embed.addFields({
      name: '⬆️ To Move Up',
      value: `+**${formatBgt(data.distanceToAbove)}** BGT\nto pass #${data.position - 1}`,
      inline: true,
    });
  } else {
    embed.addFields({
      name: '⬆️ Position',
      value: '🏆 Top Position!',
      inline: true,
    });
  }

  // Distance from below / to entry
  if (!data.isFedaykin && data.distanceToEntry !== null) {
    embed.addFields({
      name: '🚪 To Entry',
      value: `+**${formatBgt(data.distanceToEntry)}** BGT\nto join Fedaykin`,
      inline: true,
    });
  } else if (data.distanceToBelow !== null) {
    embed.addFields({
      name: '⬇️ Buffer',
      value: `**${formatBgt(data.distanceToBelow)}** BGT\nbefore #${data.position + 1} passes you`,
      inline: true,
    });
  }

  embed.setFooter({
    text: 'Manage alerts with /alerts • Position updates are sent based on your frequency preference',
  });

  return embed;
}

/**
 * At-Risk Warning Embed
 * Bottom 10% warning (positions 63-69)
 */
function buildAtRiskWarningEmbed(data: AtRiskWarningAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('⚠️ At-Risk Warning')
    .setColor(ALERT_COLORS.at_risk_warning)
    .setTimestamp();

  embed.setDescription(
    `**Your position is at risk!**\n\n` +
    `You are in the bottom 10% of eligible members (positions 63-69). ` +
    `If your BGT holdings decrease or others accumulate more, you may lose your Fedaykin status.`
  );

  embed.addFields({
    name: '📍 Your Position',
    value: `**#${data.position}** of 69`,
    inline: true,
  });

  embed.addFields({
    name: '💰 Your BGT',
    value: `**${formatBgt(data.bgt)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '⬇️ Threat Distance',
    value: `**${formatBgt(data.distanceToBelow)}** BGT\nbefore you're bumped`,
    inline: true,
  });

  // Risk assessment
  const riskLevel = data.positionsAtRisk <= 2 ? '🔴 HIGH' :
                    data.positionsAtRisk <= 4 ? '🟠 MEDIUM' : '🟡 LOW';

  embed.addFields({
    name: '🎯 Risk Level',
    value: `${riskLevel}\n${data.positionsAtRisk} position${data.positionsAtRisk > 1 ? 's' : ''} from safety`,
    inline: false,
  });

  embed.setFooter({
    text: 'Consider increasing your BGT holdings to secure your position • Disable with /alerts',
  });

  return embed;
}

/**
 * Naib Threat Embed
 * Someone challenging your Naib seat
 */
function buildNaibThreatEmbed(data: NaibThreatAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🚨 Naib Seat Threat')
    .setColor(ALERT_COLORS.naib_threat)
    .setTimestamp();

  embed.setDescription(
    `**Your Naib seat is under threat!**\n\n` +
    `A challenger has accumulated enough BGT to potentially take your seat. ` +
    `If they maintain their position during the next sync, you will be bumped.`
  );

  embed.addFields({
    name: '🪑 Your Seat',
    value: `**Seat #${data.seatNumber}**`,
    inline: true,
  });

  embed.addFields({
    name: '💰 Your BGT',
    value: `**${formatBgt(data.currentBgt)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '⚔️ Challenger BGT',
    value: `**${formatBgt(data.challengerBgt)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '📉 Deficit',
    value: `You need **+${formatBgt(data.deficit)}** BGT to match the challenger`,
    inline: false,
  });

  embed.setFooter({
    text: 'Naib seats are defended by BGT holdings • Tenure is the tie-breaker',
  });

  return embed;
}

/**
 * Naib Bump Embed
 * You were bumped from Naib
 */
function buildNaibBumpEmbed(data: NaibBumpAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('👋 Naib Transition')
    .setColor(ALERT_COLORS.naib_bump)
    .setTimestamp();

  embed.setDescription(
    `**You have been bumped from your Naib seat.**\n\n` +
    `A member with higher BGT holdings has taken Seat #${data.seatNumber}. ` +
    `You have been granted the **@Former Naib** role in recognition of your service.`
  );

  embed.addFields({
    name: '🪑 Lost Seat',
    value: `**Seat #${data.seatNumber}**`,
    inline: true,
  });

  embed.addFields({
    name: '💰 Your BGT',
    value: `**${formatBgt(data.bgtAtBump)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '⚔️ New Holder BGT',
    value: `**${formatBgt(data.bumpedByBgt)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '🏅 New Status',
    value: `You are now a **Former Naib** with access to the Naib Archives.\n` +
      `Your service to the Sietch is honored.`,
    inline: false,
  });

  embed.addFields({
    name: '🔄 Reclaim Your Seat',
    value: `Increase your BGT by **+${formatBgt(data.deficit + 0.0001)}** to reclaim a Naib seat.`,
    inline: false,
  });

  embed.setFooter({
    text: 'Former Naib retain access to the Naib Archives • The Sietch remembers',
  });

  return embed;
}

/**
 * Naib Seated Embed
 * Congratulations, you're now Naib
 */
function buildNaibSeatedEmbed(data: NaibSeatedAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('👑 Naib Seated!')
    .setColor(ALERT_COLORS.naib_seated)
    .setTimestamp();

  const bumpText = data.bumpedPreviousHolder
    ? `You have claimed Seat #${data.seatNumber} from the previous holder.`
    : `You have been granted Seat #${data.seatNumber}.`;

  embed.setDescription(
    `**Congratulations, Naib!**\n\n` +
    `${bumpText} ` +
    `As a Naib, you are among the top 7 BGT holders in the Sietch and have access to the exclusive Naib Chamber.`
  );

  embed.addFields({
    name: '🪑 Your Seat',
    value: `**Seat #${data.seatNumber}**`,
    inline: true,
  });

  embed.addFields({
    name: '💰 Your BGT',
    value: `**${formatBgt(data.bgt)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '🏛️ New Privileges',
    value:
      '• Access to **#naib-chamber** (private council)\n' +
      '• Access to **#naib-archives** (historical records)\n' +
      '• **@Naib** role and recognition',
    inline: false,
  });

  embed.addFields({
    name: '⚔️ Defend Your Seat',
    value: `Your seat is defended by your BGT holdings. Maintain your position to keep your seat.`,
    inline: false,
  });

  embed.setFooter({
    text: 'Welcome to the Naib Council • Lead with wisdom',
  });

  return embed;
}

/**
 * Waitlist Eligible Embed
 * Waitlist member became eligible
 */
function buildWaitlistEligibleEmbed(data: WaitlistEligibleAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🎉 You Are Now Eligible!')
    .setColor(ALERT_COLORS.waitlist_eligible)
    .setTimestamp();

  embed.setDescription(
    `**Great news! You have crossed the threshold!**\n\n` +
    `Your BGT holdings now qualify you to join the Sietch as a Fedaykin member. ` +
    `Complete the onboarding process to claim your place.`
  );

  embed.addFields({
    name: '📍 Previous Position',
    value: `#${data.previousPosition} (Waiting Pool)`,
    inline: true,
  });

  embed.addFields({
    name: '🚪 Current Position',
    value: `**#${data.currentPosition}** (Eligible!)`,
    inline: true,
  });

  embed.addFields({
    name: '💰 Your BGT',
    value: `**${formatBgt(data.bgt)}** BGT`,
    inline: true,
  });

  embed.addFields({
    name: '📝 Next Steps',
    value:
      '1. Join the Sietch Discord server (if not already)\n' +
      '2. Use `/onboard` to start the onboarding process\n' +
      '3. Complete your profile to become a Fedaykin',
    inline: false,
  });

  embed.setFooter({
    text: 'Welcome to the Sietch • May your water be shared',
  });

  return embed;
}

/**
 * Build action row with alert management buttons
 */
export function buildAlertActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('alerts_manage')
      .setLabel('Manage Alerts')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚙️'),
    new ButtonBuilder()
      .setCustomId('alerts_disable_all')
      .setLabel('Disable All')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔕')
  );
}

/**
 * Build a simple position status embed (for /position command)
 */
export function buildPositionStatusEmbed(data: {
  position: number;
  bgt: number;
  distanceToAbove: number | null;
  distanceToBelow: number | null;
  distanceToEntry: number | null;
  isNaib: boolean;
  isFedaykin: boolean;
  isAtRisk: boolean;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📍 Your Position')
    .setTimestamp();

  // Set color based on status
  if (data.isNaib) {
    embed.setColor(0xffd700); // Gold
  } else if (data.isAtRisk) {
    embed.setColor(0xff8c00); // Orange
  } else if (data.isFedaykin) {
    embed.setColor(0x4169e1); // Blue
  } else {
    embed.setColor(0x8b4513); // Brown (waitlist)
  }

  // Status line
  let status = '';
  if (data.isNaib) {
    status = '👑 **Naib** - Top 7 seat holder';
  } else if (data.isAtRisk) {
    status = '⚠️ **At Risk** - Bottom 10% of eligible';
  } else if (data.isFedaykin) {
    status = '⚔️ **Fedaykin** - Eligible member';
  } else {
    status = '⏳ **Waiting Pool** - Not yet eligible';
  }

  embed.setDescription(status);

  // Position and BGT
  embed.addFields({
    name: '📊 Position',
    value: `**#${data.position}**`,
    inline: true,
  });

  embed.addFields({
    name: '💰 BGT Holdings',
    value: `**${formatBgt(data.bgt)}** BGT`,
    inline: true,
  });

  // Spacer
  embed.addFields({ name: '\u200b', value: '\u200b', inline: true });

  // Distances
  if (data.distanceToAbove !== null) {
    embed.addFields({
      name: '⬆️ To Move Up',
      value: `+**${formatBgt(data.distanceToAbove)}** BGT`,
      inline: true,
    });
  }

  if (data.distanceToBelow !== null) {
    embed.addFields({
      name: '⬇️ Buffer',
      value: `**${formatBgt(data.distanceToBelow)}** BGT`,
      inline: true,
    });
  }

  if (data.distanceToEntry !== null && !data.isFedaykin) {
    embed.addFields({
      name: '🚪 To Entry',
      value: `+**${formatBgt(data.distanceToEntry)}** BGT`,
      inline: true,
    });
  }

  embed.setFooter({
    text: 'Use /alerts to manage position notifications',
  });

  return embed;
}

/**
 * Tier Promotion Embed
 * Celebrate member's tier advancement
 */
function buildTierPromotionEmbed(data: TierPromotionAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🎉 Tier Promotion!')
    .setColor(ALERT_COLORS.tier_promotion)
    .setTimestamp();

  // Different messaging for rank-based vs BGT-based tiers
  if (data.isRankBased) {
    embed.setDescription(
      `**Congratulations!**\n\n` +
      `You have been promoted to **${data.newTierName}**!\n` +
      `Your dedication and contributions to the Sietch have been recognized.`
    );
  } else {
    embed.setDescription(
      `**Congratulations!**\n\n` +
      `You have reached the **${data.newTierName}** tier!\n` +
      `Your BGT holdings have crossed a new threshold.`
    );
  }

  embed.addFields({
    name: '⬆️ Previous Tier',
    value: data.oldTier ? `**${data.oldTier}**` : 'None',
    inline: true,
  });

  embed.addFields({
    name: '✨ New Tier',
    value: `**${data.newTierName}**`,
    inline: true,
  });

  if (data.bgtThreshold !== null) {
    embed.addFields({
      name: '💰 BGT Threshold',
      value: `**${data.bgtThreshold.toLocaleString()}** BGT`,
      inline: true,
    });
  }

  embed.addFields({
    name: '🏅 New Privileges',
    value: `You now have access to the **@${data.newTierName}** role and any associated channel permissions.`,
    inline: false,
  });

  embed.setFooter({
    text: 'Keep contributing to the Sietch • May your water always be shared',
  });

  return embed;
}

/**
 * Badge Award Embed
 * Celebrate badge being awarded to member
 */
function buildBadgeAwardAlertEmbed(data: BadgeAwardAlertData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${data.badgeEmoji || '🏅'} Badge Awarded!`)
    .setColor(ALERT_COLORS.badge_award)
    .setTimestamp();

  // Special messaging for Water Sharer badge
  if (data.isWaterSharer) {
    embed.setDescription(
      `**You have received the Water Sharer badge!**\n\n` +
      `This badge recognizes you as a trusted member of the Sietch. ` +
      `You can now share this badge with one other existing member using \`/water-share share @user\`.`
    );
  } else {
    embed.setDescription(
      `**You have been awarded a badge!**\n\n` +
      `This badge recognizes your contributions to the Sietch community.`
    );
  }

  embed.addFields({
    name: `${data.badgeEmoji || '🏅'} Badge`,
    value: `**${data.badgeName}**`,
    inline: true,
  });

  embed.addFields({
    name: '📝 Description',
    value: data.badgeDescription || 'A special recognition badge.',
    inline: false,
  });

  if (data.awardReason) {
    embed.addFields({
      name: '💬 Award Reason',
      value: data.awardReason,
      inline: false,
    });
  }

  if (data.isWaterSharer) {
    embed.addFields({
      name: '🏝️ The Oasis Access',
      value: 'You now have access to **#the-oasis** - an exclusive channel for Water Sharers.',
      inline: false,
    });

    embed.addFields({
      name: '💧 Water Sharing',
      value: `Use \`/water-share share @user\` to share your badge with another member.\n` +
        `Use \`/water-share status\` to check your sharing status.`,
      inline: false,
    });
  }

  embed.setFooter({
    text: 'View your badges with /profile • The Sietch remembers',
  });

  return embed;
}

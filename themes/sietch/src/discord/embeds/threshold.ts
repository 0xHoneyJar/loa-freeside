/**
 * Threshold Embeds
 *
 * Discord embeds for the Cave Entrance threshold display.
 * Shows entry requirements and waitlist positions.
 *
 * Color: Desert brown (#8B4513) - Sand of the outer desert
 */

import { EmbedBuilder } from 'discord.js';
import type { ThresholdData, WaitlistPosition } from '../../types/index.js';

/**
 * Desert brown color for Cave Entrance embeds
 */
const THRESHOLD_COLOR = 0x8b4513;

/**
 * Format BGT amount for display (max 4 decimal places)
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
 * Build the main threshold embed showing entry requirements
 */
export function buildThresholdEmbed(
  data: ThresholdData,
  topWaitlist: WaitlistPosition[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('⛩️ The Threshold')
    .setDescription(
      'The entry requirements for joining the Sietch. ' +
      'Those who hold sufficient BGT may pass through and join the Fedaykin.'
    )
    .setColor(THRESHOLD_COLOR)
    .setTimestamp(data.updatedAt);

  // Entry threshold field
  embed.addFields({
    name: '🚪 Entry Requirement',
    value: `**${formatBgt(data.entryThreshold)} BGT**\n` +
      `Position #69 threshold`,
    inline: true,
  });

  // Statistics field
  embed.addFields({
    name: '📊 Statistics',
    value: `Eligible: **${data.eligibleCount}** members\n` +
      `Waiting: **${data.waitlistCount}** positions`,
    inline: true,
  });

  // Gap to entry (if applicable)
  if (data.gapToEntry !== null && data.gapToEntry > 0) {
    embed.addFields({
      name: '📏 Gap to Entry',
      value: `**${formatBgt(data.gapToEntry)} BGT**\n` +
        `Distance from #70 to entry`,
      inline: true,
    });
  }

  // Top waitlist positions
  if (topWaitlist.length > 0) {
    const waitlistLines = topWaitlist.map((pos) => {
      const registered = pos.isRegistered ? ' 📬' : '';
      return `**#${pos.position}** ${pos.addressDisplay}${registered}\n` +
        `└ ${formatBgt(pos.bgt)} BGT • +${formatBgt(pos.distanceToEntry)} to entry`;
    });

    embed.addFields({
      name: '⏳ Waiting Pool (Top 5)',
      value: waitlistLines.join('\n\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: '⏳ Waiting Pool',
      value: 'No wallets currently in positions 70-100',
      inline: false,
    });
  }

  // Footer
  embed.setFooter({
    text: '📬 = Registered for alerts • Use /register-waitlist to sign up',
  });

  return embed;
}

/**
 * Build a compact threshold embed for quick display
 */
export function buildThresholdCompactEmbed(data: ThresholdData): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('⛩️ Current Threshold')
    .setDescription(
      `**${formatBgt(data.entryThreshold)} BGT** required to enter\n` +
      `${data.eligibleCount} eligible • ${data.waitlistCount} waiting`
    )
    .setColor(THRESHOLD_COLOR)
    .setTimestamp(data.updatedAt);
}

/**
 * Build embed for waitlist registration success
 */
export function buildWaitlistRegistrationEmbed(
  position: WaitlistPosition
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📬 Waitlist Registration Complete')
    .setDescription(
      'You have been registered for eligibility alerts. ' +
      "We'll notify you when you become eligible to join the Sietch!"
    )
    .setColor(THRESHOLD_COLOR)
    .addFields(
      {
        name: 'Your Position',
        value: `**#${position.position}**`,
        inline: true,
      },
      {
        name: 'Your BGT',
        value: `**${formatBgt(position.bgt)}**`,
        inline: true,
      },
      {
        name: 'Distance to Entry',
        value: `**+${formatBgt(position.distanceToEntry)} BGT**`,
        inline: true,
      }
    )
    .addFields({
      name: 'Wallet',
      value: `\`${position.addressDisplay}\``,
      inline: false,
    })
    .setFooter({
      text: 'You now have the @Taqwa role and access to Cave Entrance channels',
    })
    .setTimestamp();
}

/**
 * Build embed for waitlist registration error
 */
export function buildWaitlistErrorEmbed(error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('❌ Registration Failed')
    .setDescription(error)
    .setColor(0xff4444)
    .setTimestamp();
}

/**
 * Build embed for waitlist unregistration
 */
export function buildWaitlistUnregisterEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('👋 Unregistered from Waitlist')
    .setDescription(
      'You have been removed from the waitlist. ' +
      'You will no longer receive eligibility alerts.'
    )
    .setColor(THRESHOLD_COLOR)
    .setFooter({
      text: 'Use /register-waitlist to sign up again',
    })
    .setTimestamp();
}

/**
 * Build embed showing waitlist status for a registered user
 */
export function buildWaitlistStatusEmbed(
  position: WaitlistPosition | null,
  registeredAt: Date
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📬 Your Waitlist Status')
    .setColor(THRESHOLD_COLOR)
    .setTimestamp();

  if (position) {
    embed.setDescription(
      `You are registered and tracking position **#${position.position}**`
    );
    embed.addFields(
      {
        name: 'Current Position',
        value: `**#${position.position}**`,
        inline: true,
      },
      {
        name: 'Current BGT',
        value: `**${formatBgt(position.bgt)}**`,
        inline: true,
      },
      {
        name: 'Distance to Entry',
        value: `**+${formatBgt(position.distanceToEntry)} BGT**`,
        inline: true,
      }
    );
    embed.addFields({
      name: 'Registered Wallet',
      value: `\`${position.addressDisplay}\``,
      inline: false,
    });
  } else {
    embed.setDescription(
      '⚠️ Your registered wallet is no longer in the tracked range (70-100). ' +
      'It may have dropped below position 100 or moved above position 69.'
    );
  }

  embed.addFields({
    name: 'Registered Since',
    value: `<t:${Math.floor(registeredAt.getTime() / 1000)}:R>`,
    inline: false,
  });

  embed.setFooter({
    text: 'Use /unregister-waitlist to remove your registration',
  });

  return embed;
}

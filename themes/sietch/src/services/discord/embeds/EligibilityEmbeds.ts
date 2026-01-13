/**
 * Eligibility Embed Builders
 *
 * Builds DM embeds for eligibility status changes (removal, promotion, demotion).
 */

import { EmbedBuilder } from 'discord.js';
import type { EligibilityEntry } from '../../../types/index.js';
import { COLORS, formatBGT } from '../constants.js';

/**
 * Build removal DM embed
 */
export function buildRemovalDMEmbed(entry: EligibilityEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Sietch Access Update')
    .setDescription('Your access to Sietch has been revoked.')
    .setColor(COLORS.RED)
    .addFields(
      { name: 'Reason', value: 'You have fallen below rank 69 in BGT holdings.', inline: false },
      { name: 'Previous Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
      { name: 'Current Status', value: 'Not Eligible', inline: true }
    )
    .setFooter({ text: 'If you believe this is an error, please contact support.' })
    .setTimestamp();
}

/**
 * Build Naib demotion DM embed
 */
export function buildNaibDemotionDMEmbed(entry: EligibilityEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Naib Council Update')
    .setDescription('You have been moved from the Naib Council to Fedaykin.')
    .setColor(COLORS.PURPLE)
    .addFields(
      { name: 'Reason', value: 'Your rank has fallen below the top 7.', inline: false },
      { name: 'New Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
      { name: 'New Role', value: 'Fedaykin', inline: true }
    )
    .setFooter({ text: 'You still have access to Sietch as a Fedaykin.' })
    .setTimestamp();
}

/**
 * Build Naib promotion DM embed
 */
export function buildNaibPromotionDMEmbed(entry: EligibilityEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Welcome to the Naib Council!')
    .setDescription('Congratulations! You have been promoted to Naib.')
    .setColor(COLORS.GOLD)
    .addFields(
      { name: 'Your Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
      { name: 'BGT Held', value: `${formatBGT(entry.bgtHeld)} BGT`, inline: true }
    )
    .setFooter({ text: 'You now have access to the Naib Council channels.' })
    .setTimestamp();
}

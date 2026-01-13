/**
 * Announcement Embed Builders
 *
 * Builds embeds for #the-door announcements (departures, promotions, new members).
 */

import { EmbedBuilder } from 'discord.js';
import type { EligibilityEntry } from '../../../types/index.js';
import { COLORS, truncateAddress, formatBGT } from '../constants.js';

/**
 * Build departure announcement embed for #the-door
 */
export function buildDepartureAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Departure')
    .setColor(COLORS.RED)
    .addFields(
      { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
      { name: 'Reason', value: 'Rank change (now below #69)', inline: true },
      { name: 'Previous Role', value: entry.role === 'naib' ? 'Naib' : 'Fedaykin', inline: true }
    )
    .setTimestamp();
}

/**
 * Build Naib demotion announcement embed for #the-door
 */
export function buildNaibDemotionAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Naib Council Change')
    .setColor(COLORS.PURPLE)
    .addFields(
      { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
      { name: 'Change', value: 'Naib to Fedaykin', inline: true },
      { name: 'New Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true }
    )
    .setTimestamp();
}

/**
 * Build Naib promotion announcement embed for #the-door
 */
export function buildNaibPromotionAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('New Naib Council Member')
    .setColor(COLORS.GOLD)
    .addFields(
      { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
      { name: 'Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
      { name: 'BGT Held', value: `${formatBGT(entry.bgtHeld)} BGT`, inline: true }
    )
    .setTimestamp();
}

/**
 * Build new eligible announcement embed for #the-door
 */
export function buildNewEligibleAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
  const roleName = entry.role === 'naib' ? 'Naib' : 'Fedaykin';

  return new EmbedBuilder()
    .setTitle('New Eligible Member')
    .setColor(COLORS.GREEN)
    .addFields(
      { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
      { name: 'Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
      { name: 'Role', value: roleName, inline: true }
    )
    .setFooter({ text: 'Welcome to Sietch!' })
    .setTimestamp();
}

/**
 * Leaderboard Embed Builders
 *
 * Builds embeds for the BGT Census leaderboard display.
 */

import { EmbedBuilder } from 'discord.js';
import type { EligibilityEntry } from '../../../types/index.js';
import { COLORS, truncateAddress, formatBGT, chunkString } from '../constants.js';

/**
 * Build the leaderboard embed
 */
export function buildLeaderboardEmbed(
  eligibility: EligibilityEntry[],
  updatedAt: Date | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('BGT Census')
    .setDescription(`Last Updated: ${updatedAt?.toISOString() ?? 'Unknown'}`)
    .setColor(COLORS.GOLD)
    .setTimestamp();

  // Top 7 (Naib Council)
  const naibList = eligibility
    .filter((e) => e.rank !== undefined && e.rank <= 7)
    .map((e) => `**${e.rank}.** \`${truncateAddress(e.address)}\` - ${formatBGT(e.bgtHeld)} BGT`)
    .join('\n');

  if (naibList) {
    embed.addFields({
      name: 'Naib Council',
      value: naibList || 'No members',
      inline: false,
    });
  }

  // Fedaykin (8-69)
  const fedaykinList = eligibility
    .filter((e) => e.rank !== undefined && e.rank > 7 && e.rank <= 69)
    .map((e) => `**${e.rank}.** \`${truncateAddress(e.address)}\` - ${formatBGT(e.bgtHeld)} BGT`)
    .join('\n');

  if (fedaykinList) {
    // Split into multiple fields if needed (Discord limit: 1024 chars per field)
    const chunks = chunkString(fedaykinList, 1024);
    chunks.forEach((chunk, idx) => {
      embed.addFields({
        name: idx === 0 ? 'Fedaykin' : '\u200b',
        value: chunk,
        inline: false,
      });
    });
  }

  // Footer with total count
  const totalEligible = eligibility.filter((e) => e.rank !== undefined && e.rank <= 69).length;
  embed.setFooter({ text: `Total Eligible: ${totalEligible}/69` });

  return embed;
}

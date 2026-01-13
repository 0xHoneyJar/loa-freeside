/**
 * Discord Notification Operations
 *
 * DM sending, badge notifications, and fallback message handling.
 */

import type { Guild, User, EmbedBuilder, TextChannel } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { COLORS } from '../constants.js';
import { getMemberById } from './RoleOperations.js';
import { getBotChannel } from './GuildOperations.js';

/**
 * Send a DM to a user with fallback to channel message
 */
export async function sendDMWithFallback(
  guild: Guild | null,
  user: User,
  content: { embeds?: EmbedBuilder[]; content?: string }
): Promise<boolean> {
  try {
    await user.send(content);
    return true;
  } catch (error) {
    logger.warn({ userId: user.id, error }, 'Could not send DM, trying channel fallback');

    // Try sending to bot channel as ephemeral-like message
    const channel = await getBotChannel(guild);
    if (channel) {
      try {
        await channel.send({
          content: `<@${user.id}> ` + (content.content ?? ''),
          embeds: content.embeds,
        });
        return true;
      } catch (channelError) {
        logger.error({ error: channelError }, 'Failed to send fallback message');
      }
    }

    return false;
  }
}

/**
 * Notify user about badge award
 */
export async function notifyBadgeAwarded(
  guild: Guild | null,
  discordUserId: string,
  badgeName: string,
  badgeEmoji: string,
  badgeDescription: string
): Promise<void> {
  const member = await getMemberById(guild, discordUserId);
  if (!member) return;

  // Dynamic import to avoid circular dependency
  const { EmbedBuilder } = await import('discord.js');

  const embed = new EmbedBuilder()
    .setTitle(`${badgeEmoji} New Badge Earned!`)
    .setDescription(`Congratulations! You've earned the **${badgeName}** badge.`)
    .addFields({ name: 'Description', value: badgeDescription })
    .setColor(COLORS.GOLD)
    .setFooter({ text: 'Use /badges to view all your badges' })
    .setTimestamp();

  await sendDMWithFallback(guild, member.user, { embeds: [embed] });
}

/**
 * Post an embed to a specific channel
 */
export async function postToChannel(
  channel: TextChannel | null,
  embed: EmbedBuilder
): Promise<boolean> {
  if (!channel) {
    logger.warn('Cannot post: channel not found');
    return false;
  }

  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.error({ error, channelId: channel.id }, 'Failed to post to channel');
    return false;
  }
}

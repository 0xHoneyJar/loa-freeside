/**
 * Discord Guild Operations
 *
 * Guild-level operations: member lookup, channel access, connection management.
 */

import type { Guild, GuildMember, TextChannel } from 'discord.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';
import { getDiscordIdByWallet } from '../../../db/index.js';

/**
 * Find a Discord member by their wallet address
 */
export async function findMemberByWallet(
  guild: Guild | null,
  walletAddress: string
): Promise<GuildMember | null> {
  const discordId = getDiscordIdByWallet(walletAddress);
  if (!discordId) {
    return null;
  }

  if (!guild) {
    return null;
  }

  try {
    return await guild.members.fetch(discordId);
  } catch (error) {
    logger.debug({ walletAddress, discordId, error }, 'Could not find member');
    return null;
  }
}

/**
 * Get the bot commands channel (for fallback messages)
 */
export async function getBotChannel(guild: Guild | null): Promise<TextChannel | null> {
  if (!guild) {
    return null;
  }

  try {
    // Try sietch lounge first, then fallback to the-door
    const channelId = config.discord.channels.sietchLounge ?? config.discord.channels.theDoor;
    const channel = await guild.channels.fetch(channelId);
    return channel instanceof (await import('discord.js')).TextChannel ? channel : null;
  } catch (error) {
    logger.error({ error }, 'Failed to get bot channel');
    return null;
  }
}

/**
 * Get a text channel by ID
 */
export async function getTextChannel(
  guild: Guild,
  channelId: string
): Promise<TextChannel | null> {
  try {
    const channel = await guild.channels.fetch(channelId);
    const { TextChannel: TextChannelClass } = await import('discord.js');
    if (channel instanceof TextChannelClass) {
      return channel;
    }
    return null;
  } catch (error) {
    logger.error({ error, channelId }, 'Failed to fetch channel');
    return null;
  }
}

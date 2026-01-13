/**
 * Discord Role Operations
 *
 * Role assignment and management operations for guild members.
 */

import type { Guild, GuildMember } from 'discord.js';
import { logger } from '../../../utils/logger.js';

/**
 * Get a guild member by Discord ID
 */
export async function getMemberById(
  guild: Guild | null,
  discordUserId: string
): Promise<GuildMember | null> {
  if (!guild) {
    logger.warn('Cannot get member: Discord not connected');
    return null;
  }

  try {
    return await guild.members.fetch(discordUserId);
  } catch (error) {
    logger.debug({ discordUserId, error }, 'Could not fetch member');
    return null;
  }
}

/**
 * Assign a role to a member
 */
export async function assignRole(
  guild: Guild | null,
  discordUserId: string,
  roleId: string
): Promise<boolean> {
  if (!guild) {
    logger.warn('Cannot assign role: Discord not connected');
    return false;
  }

  try {
    const member = await guild.members.fetch(discordUserId);
    await member.roles.add(roleId);
    logger.info({ discordUserId, roleId }, 'Assigned role to member');
    return true;
  } catch (error) {
    logger.error({ error, discordUserId, roleId }, 'Failed to assign role');
    return false;
  }
}

/**
 * Remove a role from a member
 */
export async function removeRole(
  guild: Guild | null,
  discordUserId: string,
  roleId: string
): Promise<boolean> {
  if (!guild) {
    logger.warn('Cannot remove role: Discord not connected');
    return false;
  }

  try {
    const member = await guild.members.fetch(discordUserId);
    await member.roles.remove(roleId);
    logger.info({ discordUserId, roleId }, 'Removed role from member');
    return true;
  } catch (error) {
    logger.error({ error, discordUserId, roleId }, 'Failed to remove role');
    return false;
  }
}

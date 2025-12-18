import {
  REST,
  Routes,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { profileCommand } from './profile.js';
import { badgesCommand } from './badges.js';
import { statsCommand } from './stats.js';
import { adminBadgeCommand } from './admin-badge.js';

/**
 * All registered slash commands
 */
export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  profileCommand,
  badgesCommand.toJSON(),
  statsCommand.toJSON(),
  adminBadgeCommand.toJSON(),
];

/**
 * Command name to handler mapping
 */
export { handleProfileCommand } from './profile.js';
export { handleBadgesCommand, handleBadgesAutocomplete } from './badges.js';
export { handleStatsCommand } from './stats.js';
export { handleAdminBadgeCommand, handleAdminBadgeAutocomplete } from './admin-badge.js';

/**
 * Register slash commands with Discord API
 */
export async function registerCommands(clientId: string): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discord.botToken);

  try {
    logger.info(
      { commandCount: commands.length },
      'Registering slash commands...'
    );

    // Register commands for the guild (instant update)
    await rest.put(
      Routes.applicationGuildCommands(clientId, config.discord.guildId),
      { body: commands }
    );

    logger.info(
      { commandCount: commands.length, guildId: config.discord.guildId },
      'Successfully registered slash commands'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to register slash commands');
    throw error;
  }
}

/**
 * Unregister all slash commands (for cleanup)
 */
export async function unregisterCommands(clientId: string): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discord.botToken);

  try {
    logger.info('Unregistering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, config.discord.guildId),
      { body: [] }
    );

    logger.info('Successfully unregistered slash commands');
  } catch (error) {
    logger.error({ error }, 'Failed to unregister slash commands');
    throw error;
  }
}

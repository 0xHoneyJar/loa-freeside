import {
  REST,
  Routes,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { profileCommand } from './profile.js';

/**
 * All registered slash commands
 */
export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  profileCommand,
];

/**
 * Command name to handler mapping
 */
export { handleProfileCommand } from './profile.js';

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

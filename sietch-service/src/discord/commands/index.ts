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
import { directoryCommand } from './directory.js';
import { leaderboardCommand } from './leaderboard.js';
import { naibCommand } from './naib.js';
import { thresholdCommand } from './threshold.js';
import { registerWaitlistCommand } from './register-waitlist.js';
import { alertsCommand } from './alerts.js';
import { positionCommand } from './position.js';
import { waterShareCommand } from './water-share.js';

/**
 * All registered slash commands
 */
export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  profileCommand,
  badgesCommand.toJSON(),
  statsCommand.toJSON(),
  adminBadgeCommand.toJSON(),
  directoryCommand.toJSON(),
  leaderboardCommand.toJSON(),
  naibCommand.toJSON(),
  thresholdCommand.toJSON(),
  registerWaitlistCommand.toJSON(),
  // Sprint 13: Notification System commands
  alertsCommand.toJSON(),
  positionCommand.toJSON(),
  // Sprint 17: Water Sharer commands
  waterShareCommand.toJSON(),
];

/**
 * Command name to handler mapping
 */
export { handleProfileCommand } from './profile.js';
export { handleBadgesCommand, handleBadgesAutocomplete } from './badges.js';
export { handleStatsCommand } from './stats.js';
export { handleAdminBadgeCommand, handleAdminBadgeAutocomplete } from './admin-badge.js';

// Sprint 9: Directory & Leaderboard commands
export {
  handleDirectoryCommand,
  handleDirectoryButton,
  handleDirectorySelect,
  DIRECTORY_INTERACTIONS,
} from './directory.js';
export { handleLeaderboardCommand } from './leaderboard.js';

// Sprint 11: Naib Council command
export { handleNaibCommand } from './naib.js';

// Sprint 12: Cave Entrance commands
export { handleThresholdCommand } from './threshold.js';
export { handleRegisterWaitlistCommand } from './register-waitlist.js';

// Sprint 13: Notification System commands
export { handleAlertsCommand } from './alerts.js';
export { handlePositionCommand } from './position.js';

// Sprint 17: Water Sharer commands
export { handleWaterShareCommand } from './water-share.js';

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

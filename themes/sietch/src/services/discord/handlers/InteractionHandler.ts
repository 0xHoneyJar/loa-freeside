/**
 * Discord Interaction Handler
 *
 * Routes incoming Discord interactions (slash commands, buttons, modals, select menus)
 * to their appropriate handlers.
 */

import type {
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { logger } from '../../../utils/logger.js';
import {
  handleProfileCommand,
  handleBadgesCommand,
  handleStatsCommand,
  handleAdminBadgeCommand,
  handleAdminStatsCommand,
  handleDirectoryCommand,
  handleDirectoryButton,
  handleDirectorySelect,
  handleLeaderboardCommand,
  handleNaibCommand,
  handleThresholdCommand,
  handleRegisterWaitlistCommand,
  handleWaterShareCommand,
  handleAdminWaterShareCommand,
  DIRECTORY_INTERACTIONS,
} from '../../../discord/commands/index.js';
import {
  isOnboardingButton,
  isOnboardingModal,
  handleOnboardingButton,
  handleOnboardingModal,
} from '../../../discord/interactions/index.js';
import { handleAutocomplete } from './AutocompleteHandler.js';

/**
 * Handle incoming Discord interactions
 */
export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
      return;
    }

    // Button clicks
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      await handleModalInteraction(interaction);
      return;
    }

    // String select menus
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction);
      return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }
  } catch (error) {
    logger.error({ error, interactionType: interaction.type }, 'Error handling interaction');
  }
}

/**
 * Handle slash command interactions
 */
async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;

  switch (commandName) {
    case 'profile':
      await handleProfileCommand(interaction);
      break;
    case 'badges':
      await handleBadgesCommand(interaction);
      break;
    case 'stats':
      await handleStatsCommand(interaction);
      break;
    case 'admin-badge':
      await handleAdminBadgeCommand(interaction);
      break;
    case 'admin-stats':
      await handleAdminStatsCommand(interaction);
      break;
    case 'directory':
      await handleDirectoryCommand(interaction);
      break;
    case 'leaderboard':
      await handleLeaderboardCommand(interaction);
      break;
    case 'naib':
      await handleNaibCommand(interaction);
      break;
    case 'threshold':
      await handleThresholdCommand(interaction);
      break;
    case 'register-waitlist':
      await handleRegisterWaitlistCommand(interaction);
      break;
    case 'water-share':
      await handleWaterShareCommand(interaction);
      break;
    case 'admin-water-share':
      await handleAdminWaterShareCommand(interaction);
      break;
    default:
      logger.warn({ commandName }, 'Unknown slash command');
      await interaction.reply({
        content: 'Unknown command',
        ephemeral: true,
      });
  }
}

/**
 * Handle button interactions
 */
async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  // Onboarding buttons
  if (isOnboardingButton(customId)) {
    await handleOnboardingButton(interaction);
    return;
  }

  // Directory pagination buttons
  if (isDirectoryButton(customId)) {
    await handleDirectoryButton(interaction);
    return;
  }

  logger.warn({ customId }, 'Unknown button interaction');
}

/**
 * Handle string select menu interactions
 */
async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId } = interaction;

  // Directory filter/sort select menus
  if (isDirectorySelectMenu(customId)) {
    await handleDirectorySelect(interaction);
    return;
  }

  logger.warn({ customId }, 'Unknown select menu interaction');
}

/**
 * Handle modal submission interactions
 */
async function handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  // Onboarding modals
  if (isOnboardingModal(customId)) {
    await handleOnboardingModal(interaction);
    return;
  }

  logger.warn({ customId }, 'Unknown modal interaction');
}

/**
 * Check if a custom ID is a directory button
 */
function isDirectoryButton(customId: string): boolean {
  return (
    customId === DIRECTORY_INTERACTIONS.prevPage ||
    customId === DIRECTORY_INTERACTIONS.nextPage ||
    customId === DIRECTORY_INTERACTIONS.refresh
  );
}

/**
 * Check if a custom ID is a directory select menu
 */
function isDirectorySelectMenu(customId: string): boolean {
  return (
    customId === DIRECTORY_INTERACTIONS.tierFilter ||
    customId === DIRECTORY_INTERACTIONS.sortBy
  );
}

/**
 * /directory Slash Command
 *
 * Interactive member directory browser with pagination and filters.
 *
 * Usage:
 * - /directory - Opens interactive directory browser (ephemeral)
 *
 * Features:
 * - Paginated member list
 * - Filter by tier (Naib/Fedaykin)
 * - Filter by badge
 * - Filter by tenure category
 * - Sort by nym, tenure, or badge count
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type MessageActionRowComponentBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { directoryService } from '../../services/directory.js';
import { getMemberProfileByDiscordId } from '../../db/queries.js';
import { buildDirectoryEmbed } from '../embeds/directory.js';
import type { DirectoryFilters } from '../../types/index.js';

/**
 * Custom ID prefixes for directory interactions
 */
export const DIRECTORY_INTERACTIONS = {
  // Buttons
  prevPage: 'directory_prev',
  nextPage: 'directory_next',
  refresh: 'directory_refresh',
  // Select menus
  tierFilter: 'directory_tier',
  sortBy: 'directory_sort',
} as const;

/**
 * In-memory state for directory sessions
 * Key: Discord user ID, Value: current filters
 */
const sessionFilters = new Map<string, DirectoryFilters>();

/**
 * Session timeout (5 minutes)
 */
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Slash command definition
 */
export const directoryCommand = new SlashCommandBuilder()
  .setName('directory')
  .setDescription('Browse the member directory');

/**
 * Handle /directory command execution
 */
export async function handleDirectoryCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
    // Check if user has completed onboarding
    const profile = getMemberProfileByDiscordId(discordUserId);
    if (!profile || !profile.onboardingComplete) {
      await interaction.reply({
        content:
          'You need to complete onboarding first to browse the directory. ' +
          'Check your DMs for the onboarding wizard.',
        ephemeral: true,
      });
      return;
    }

    // Initialize session with default filters
    const filters: DirectoryFilters = {
      page: 1,
      pageSize: 10,
      sortBy: 'nym',
      sortDir: 'asc',
    };
    sessionFilters.set(discordUserId, filters);

    // Schedule session cleanup
    setTimeout(() => {
      sessionFilters.delete(discordUserId);
    }, SESSION_TIMEOUT_MS);

    // Get directory data
    const result = directoryService.getDirectory(filters);

    // Build embed and components
    const embed = buildDirectoryEmbed(result);
    const components = buildDirectoryComponents(filters, result.page, result.totalPages);

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling /directory command');

    const errorMessage = 'An error occurred while loading the directory. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle directory button interactions (pagination)
 */
export async function handleDirectoryButton(
  interaction: ButtonInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const customId = interaction.customId;

  try {
    // Get or create session filters
    let filters = sessionFilters.get(discordUserId);
    if (!filters) {
      filters = {
        page: 1,
        pageSize: 10,
        sortBy: 'nym',
        sortDir: 'asc',
      };
      sessionFilters.set(discordUserId, filters);
    }

    // Handle button action
    switch (customId) {
      case DIRECTORY_INTERACTIONS.prevPage:
        filters.page = Math.max(1, (filters.page ?? 1) - 1);
        break;
      case DIRECTORY_INTERACTIONS.nextPage:
        filters.page = (filters.page ?? 1) + 1;
        break;
      case DIRECTORY_INTERACTIONS.refresh:
        // Just refresh with current filters
        break;
      default:
        return;
    }

    // Update session
    sessionFilters.set(discordUserId, filters);

    // Get updated directory data
    const result = directoryService.getDirectory(filters);

    // Clamp page if we've gone past the end
    if (filters.page && filters.page > result.totalPages && result.totalPages > 0) {
      filters.page = result.totalPages;
      const updatedResult = directoryService.getDirectory(filters);
      const embed = buildDirectoryEmbed(updatedResult);
      const components = buildDirectoryComponents(filters, updatedResult.page, updatedResult.totalPages);
      await interaction.update({ embeds: [embed], components });
      return;
    }

    // Build updated embed and components
    const embed = buildDirectoryEmbed(result);
    const components = buildDirectoryComponents(filters, result.page, result.totalPages);

    await interaction.update({ embeds: [embed], components });
  } catch (error) {
    logger.error({ error, discordUserId, customId }, 'Error handling directory button');
    await interaction.reply({
      content: 'An error occurred. Please try /directory again.',
      ephemeral: true,
    });
  }
}

/**
 * Handle directory select menu interactions (filters)
 */
export async function handleDirectorySelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const customId = interaction.customId;
  const value = interaction.values[0];

  try {
    // Get or create session filters
    let filters = sessionFilters.get(discordUserId);
    if (!filters) {
      filters = {
        page: 1,
        pageSize: 10,
        sortBy: 'nym',
        sortDir: 'asc',
      };
    }

    // Handle select menu action
    switch (customId) {
      case DIRECTORY_INTERACTIONS.tierFilter:
        if (value === 'all') {
          delete filters.tier;
        } else if (value === 'naib' || value === 'fedaykin') {
          filters.tier = value;
        }
        filters.page = 1; // Reset to first page on filter change
        break;

      case DIRECTORY_INTERACTIONS.sortBy:
        if (value === 'nym' || value === 'tenure' || value === 'badgeCount') {
          filters.sortBy = value;
          // Default sort direction based on field
          filters.sortDir = value === 'nym' ? 'asc' : 'desc';
        }
        filters.page = 1; // Reset to first page on sort change
        break;

      default:
        return;
    }

    // Update session
    sessionFilters.set(discordUserId, filters);

    // Get updated directory data
    const result = directoryService.getDirectory(filters);

    // Build updated embed and components
    const embed = buildDirectoryEmbed(result);
    const components = buildDirectoryComponents(filters, result.page, result.totalPages);

    await interaction.update({ embeds: [embed], components });
  } catch (error) {
    logger.error({ error, discordUserId, customId }, 'Error handling directory select');
    await interaction.reply({
      content: 'An error occurred. Please try /directory again.',
      ephemeral: true,
    });
  }
}

/**
 * Build directory action row components
 */
function buildDirectoryComponents(
  filters: DirectoryFilters,
  currentPage: number,
  totalPages: number
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Row 1: Tier filter and sort select menus
  const filterRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // Tier filter dropdown
  const tierSelect = new StringSelectMenuBuilder()
    .setCustomId(DIRECTORY_INTERACTIONS.tierFilter)
    .setPlaceholder('Filter by tier')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('All Tiers')
        .setValue('all')
        .setEmoji('👥')
        .setDefault(!filters.tier),
      new StringSelectMenuOptionBuilder()
        .setLabel('Naib (Top 7)')
        .setValue('naib')
        .setEmoji('👑')
        .setDefault(filters.tier === 'naib'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Fedaykin')
        .setValue('fedaykin')
        .setEmoji('⚔️')
        .setDefault(filters.tier === 'fedaykin')
    );

  filterRow.addComponents(tierSelect);
  rows.push(filterRow);

  // Row 2: Sort dropdown
  const sortRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  const sortSelect = new StringSelectMenuBuilder()
    .setCustomId(DIRECTORY_INTERACTIONS.sortBy)
    .setPlaceholder('Sort by')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Name (A-Z)')
        .setValue('nym')
        .setEmoji('🔤')
        .setDefault(filters.sortBy === 'nym'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Tenure (Oldest first)')
        .setValue('tenure')
        .setEmoji('📅')
        .setDefault(filters.sortBy === 'tenure'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Badge Count')
        .setValue('badgeCount')
        .setEmoji('🏅')
        .setDefault(filters.sortBy === 'badgeCount')
    );

  sortRow.addComponents(sortSelect);
  rows.push(sortRow);

  // Row 3: Pagination buttons
  const paginationRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  paginationRow.addComponents(
    new ButtonBuilder()
      .setCustomId(DIRECTORY_INTERACTIONS.prevPage)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(DIRECTORY_INTERACTIONS.refresh)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(DIRECTORY_INTERACTIONS.nextPage)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages)
  );

  rows.push(paginationRow);

  return rows;
}

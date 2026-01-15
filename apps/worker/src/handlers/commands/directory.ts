/**
 * Directory Command Handler
 *
 * Interactive member directory browser with Redis-backed sessions.
 *
 * Features:
 * - Paginated member list
 * - Filter by tier (Naib/Fedaykin)
 * - Sort by name, tenure, or badge count
 * - Session state persisted in Redis (5 min TTL)
 *
 * Note: Directory is EPHEMERAL (private to user)
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import type { StateManager } from '../../services/StateManager.js';
import { createErrorEmbed } from '../../embeds/index.js';
import {
  buildDirectoryEmbed,
  buildDirectoryComponents,
  DIRECTORY_INTERACTIONS,
  type DirectoryFiltersState,
} from '../../embeds/directory.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getDirectory,
  type DirectoryFilters,
} from '../../data/index.js';

/**
 * Session type for Redis key
 */
const SESSION_TYPE = 'directory';

/**
 * Session timeout (5 minutes)
 */
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default filters
 */
const DEFAULT_FILTERS: DirectoryFiltersState = {
  page: 1,
  pageSize: 10,
  sortBy: 'nym',
  sortDir: 'asc',
};

/**
 * Factory function to create directory command handler
 */
export function createDirectoryHandler(discord: DiscordRestService, state: StateManager) {
  return async function handleDirectory(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<'ack' | 'requeue'> {
    const { interactionId, interactionToken, guildId, userId } = payload;

    // Validate required fields
    if (!interactionId || !interactionToken) {
      logger.warn('Missing interaction credentials for directory command');
      return 'ack';
    }

    if (!guildId) {
      logger.warn('Missing guildId for directory command');
      return 'ack';
    }

    if (!userId) {
      logger.warn('Missing userId for directory command');
      return 'ack';
    }

    try {
      // Defer reply - EPHEMERAL (private)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        logger.error({ error: deferResult.error }, 'Failed to defer directory reply');
        return 'ack';
      }

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured for Arrakis.')],
        });
        return 'ack';
      }

      // Check if user has a profile (completed onboarding)
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              'You need to complete onboarding first to browse the directory.\n' +
                'Check your DMs for the onboarding wizard.'
            ),
          ],
        });
        return 'ack';
      }

      // Initialize session with default filters
      const filters: DirectoryFiltersState = { ...DEFAULT_FILTERS };

      // Store session in Redis
      await state.setSession(
        SESSION_TYPE,
        userId,
        { ...filters, communityId: community.id },
        SESSION_TIMEOUT_MS
      );

      // Get directory data
      const result = await getDirectory(community.id, filters);

      // Build embed and components
      const embed = buildDirectoryEmbed(result);
      const components = buildDirectoryComponents(filters, result.page, result.totalPages);

      await discord.editOriginal(interactionToken, {
        embeds: [embed],
        components,
      });

      logger.info(
        {
          memberId: profile.id,
          total: result.total,
          page: result.page,
        },
        'Directory opened'
      );

      return 'ack';
    } catch (error) {
      logger.error({ error }, 'Error handling directory command');

      try {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while loading the directory.')],
        });
      } catch {
        // Ignore followup errors
      }

      return 'ack';
    }
  };
}

/**
 * Factory function to create directory button handler
 * Handles prev/next/refresh pagination
 */
export function createDirectoryButtonHandler(discord: DiscordRestService, state: StateManager) {
  return async function handleDirectoryButton(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<'ack' | 'requeue'> {
    const { interactionId, interactionToken, userId, customId } = payload;

    // Validate required fields
    if (!interactionId || !interactionToken || !userId || !customId) {
      logger.warn('Missing required fields for directory button');
      return 'ack';
    }

    // Only handle directory buttons
    if (!customId.startsWith('directory_')) {
      return 'ack';
    }

    try {
      // Get session from Redis
      const session = await state.getSession(SESSION_TYPE, userId);
      if (!session) {
        // Session expired - send error and return
        await discord.updateMessage(interactionId, interactionToken, {
          embeds: [
            createErrorEmbed('Session expired. Please run `/directory` again to start a new session.'),
          ],
          components: [], // Remove components
        });
        return 'ack';
      }

      const communityId = session.data['communityId'] as string;
      const filters: DirectoryFiltersState = {
        page: (session.data['page'] as number) ?? 1,
        pageSize: (session.data['pageSize'] as number) ?? 10,
        tier: session.data['tier'] as 'naib' | 'fedaykin' | undefined,
        sortBy: (session.data['sortBy'] as 'nym' | 'tenure' | 'badgeCount') ?? 'nym',
        sortDir: (session.data['sortDir'] as 'asc' | 'desc') ?? 'asc',
      };

      // Handle button action
      switch (customId) {
        case DIRECTORY_INTERACTIONS.prevPage:
          filters.page = Math.max(1, filters.page - 1);
          break;
        case DIRECTORY_INTERACTIONS.nextPage:
          filters.page = filters.page + 1;
          break;
        case DIRECTORY_INTERACTIONS.refresh:
          // Just refresh with current filters
          break;
        default:
          logger.warn({ customId }, 'Unknown directory button');
          return 'ack';
      }

      // Update session
      await state.setSession(
        SESSION_TYPE,
        userId,
        { ...filters, communityId },
        SESSION_TIMEOUT_MS
      );

      // Get updated directory data
      const result = await getDirectory(communityId, filters);

      // Clamp page if we've gone past the end
      if (filters.page > result.totalPages && result.totalPages > 0) {
        filters.page = result.totalPages;
        await state.setSession(
          SESSION_TYPE,
          userId,
          { ...filters, communityId },
          SESSION_TIMEOUT_MS
        );
        const updatedResult = await getDirectory(communityId, filters);
        const embed = buildDirectoryEmbed(updatedResult);
        const components = buildDirectoryComponents(filters, updatedResult.page, updatedResult.totalPages);
        await discord.updateMessage(interactionId, interactionToken, {
          embeds: [embed],
          components,
        });
        return 'ack';
      }

      // Build updated embed and components
      const embed = buildDirectoryEmbed(result);
      const components = buildDirectoryComponents(filters, result.page, result.totalPages);

      await discord.updateMessage(interactionId, interactionToken, {
        embeds: [embed],
        components,
      });

      logger.debug({ customId, page: filters.page }, 'Directory button handled');
      return 'ack';
    } catch (error) {
      logger.error({ error, customId }, 'Error handling directory button');

      try {
        await discord.updateMessage(interactionId, interactionToken, {
          embeds: [createErrorEmbed('An error occurred. Please try `/directory` again.')],
          components: [],
        });
      } catch {
        // Ignore followup errors
      }

      return 'ack';
    }
  };
}

/**
 * Factory function to create directory select menu handler
 * Handles tier filter and sort selection
 */
export function createDirectorySelectHandler(discord: DiscordRestService, state: StateManager) {
  return async function handleDirectorySelect(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<'ack' | 'requeue'> {
    const { interactionId, interactionToken, userId, customId, selectedValues } = payload;

    // Validate required fields
    if (!interactionId || !interactionToken || !userId || !customId || !selectedValues?.length) {
      logger.warn('Missing required fields for directory select');
      return 'ack';
    }

    // Only handle directory selects
    if (!customId.startsWith('directory_')) {
      return 'ack';
    }

    const value = selectedValues[0];

    try {
      // Get session from Redis
      const session = await state.getSession(SESSION_TYPE, userId);
      if (!session) {
        await discord.updateMessage(interactionId, interactionToken, {
          embeds: [
            createErrorEmbed('Session expired. Please run `/directory` again to start a new session.'),
          ],
          components: [],
        });
        return 'ack';
      }

      const communityId = session.data['communityId'] as string;
      const filters: DirectoryFiltersState = {
        page: 1, // Reset to page 1 on filter/sort change
        pageSize: (session.data['pageSize'] as number) ?? 10,
        tier: session.data['tier'] as 'naib' | 'fedaykin' | undefined,
        sortBy: (session.data['sortBy'] as 'nym' | 'tenure' | 'badgeCount') ?? 'nym',
        sortDir: (session.data['sortDir'] as 'asc' | 'desc') ?? 'asc',
      };

      // Handle select action
      switch (customId) {
        case DIRECTORY_INTERACTIONS.tierFilter:
          if (value === 'all') {
            delete filters.tier;
          } else if (value === 'naib' || value === 'fedaykin') {
            filters.tier = value;
          }
          break;

        case DIRECTORY_INTERACTIONS.sortBy:
          if (value === 'nym' || value === 'tenure' || value === 'badgeCount') {
            filters.sortBy = value;
            // Default sort direction based on field
            filters.sortDir = value === 'nym' ? 'asc' : 'desc';
          }
          break;

        default:
          logger.warn({ customId }, 'Unknown directory select');
          return 'ack';
      }

      // Update session
      await state.setSession(
        SESSION_TYPE,
        userId,
        { ...filters, communityId },
        SESSION_TIMEOUT_MS
      );

      // Get updated directory data
      const result = await getDirectory(communityId, filters);

      // Build updated embed and components
      const embed = buildDirectoryEmbed(result);
      const components = buildDirectoryComponents(filters, result.page, result.totalPages);

      await discord.updateMessage(interactionId, interactionToken, {
        embeds: [embed],
        components,
      });

      logger.debug({ customId, value, page: filters.page }, 'Directory select handled');
      return 'ack';
    } catch (error) {
      logger.error({ error, customId }, 'Error handling directory select');

      try {
        await discord.updateMessage(interactionId, interactionToken, {
          embeds: [createErrorEmbed('An error occurred. Please try `/directory` again.')],
          components: [],
        });
      } catch {
        // Ignore followup errors
      }

      return 'ack';
    }
  };
}

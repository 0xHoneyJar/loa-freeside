/**
 * Leaderboard Command Handler
 *
 * Handles /leaderboard subcommands:
 * - /leaderboard badges - Badge count rankings
 * - /leaderboard tiers - Tier progression rankings
 *
 * Note: Leaderboard is PUBLIC (ephemeral = false)
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import { createErrorEmbed } from '../../embeds/index.js';
import { buildBadgeLeaderboardEmbed, buildTierProgressionEmbed } from '../../embeds/leaderboard.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getBadgeLeaderboard,
  getMemberBadgeRank,
  getMemberCount,
  getTierProgressionLeaderboard,
  getMemberTierProgressionRank,
} from '../../data/index.js';

const DEFAULT_LEADERBOARD_SIZE = 10;

/**
 * Factory function to create leaderboard command handler
 */
export function createLeaderboardHandler(discord: DiscordRestService) {
  return async function handleLeaderboard(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<'ack' | 'requeue'> {
    const { interactionId, interactionToken, guildId, userId, subcommand } = payload;

    // Validate required fields
    if (!interactionId || !interactionToken) {
      logger.warn('Missing interaction credentials for leaderboard command');
      return 'ack';
    }

    if (!guildId) {
      logger.warn('Missing guildId for leaderboard command');
      return 'ack';
    }

    try {
      // Defer reply - PUBLIC (not ephemeral)
      const deferResult = await discord.deferReply(interactionId, interactionToken, false);
      if (!deferResult.success) {
        logger.error({ error: deferResult.error }, 'Failed to defer leaderboard reply');
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

      // Get user profile if userId provided (for "Your Position" display)
      let userProfile = null;
      if (userId) {
        userProfile = await getProfileByDiscordId(community.id, userId);
      }

      // Route to subcommand handler
      const subcommandName = subcommand ?? 'badges';

      if (subcommandName === 'badges') {
        await handleBadgesLeaderboard(
          discord,
          interactionToken,
          community.id,
          userProfile?.id ?? null,
          logger
        );
      } else if (subcommandName === 'tiers') {
        await handleTiersLeaderboard(
          discord,
          interactionToken,
          community.id,
          userProfile?.id ?? null,
          logger
        );
      } else {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              'Unknown subcommand. Use `/leaderboard badges` or `/leaderboard tiers`'
            ),
          ],
        });
      }

      return 'ack';
    } catch (error) {
      logger.error({ error }, 'Error handling leaderboard command');

      try {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while loading the leaderboard.')],
        });
      } catch {
        // Ignore followup errors
      }

      return 'ack';
    }
  };
}

/**
 * Handle /leaderboard badges subcommand
 */
async function handleBadgesLeaderboard(
  discord: DiscordRestService,
  interactionToken: string,
  communityId: string,
  profileId: string | null,
  logger: Logger
): Promise<void> {
  // Get leaderboard data
  const [entries, totalMembers] = await Promise.all([
    getBadgeLeaderboard(communityId, DEFAULT_LEADERBOARD_SIZE),
    getMemberCount(communityId),
  ]);

  // Get user's rank if they have a profile
  let userRank: number | null = null;
  if (profileId) {
    userRank = await getMemberBadgeRank(communityId, profileId);
  }

  // Build and send embed
  const embed = buildBadgeLeaderboardEmbed(entries, totalMembers, userRank);

  await discord.editOriginal(interactionToken, {
    embeds: [embed],
  });

  logger.info(
    {
      entriesCount: entries.length,
      totalMembers,
      userRank,
    },
    'Badge leaderboard served'
  );
}

/**
 * Handle /leaderboard tiers subcommand
 */
async function handleTiersLeaderboard(
  discord: DiscordRestService,
  interactionToken: string,
  communityId: string,
  profileId: string | null,
  logger: Logger
): Promise<void> {
  // Get tier progression leaderboard
  const entries = await getTierProgressionLeaderboard(communityId, DEFAULT_LEADERBOARD_SIZE);

  // Get user's entry if they're in the progression rankings
  let userEntry = null;
  if (profileId) {
    const userRank = await getMemberTierProgressionRank(communityId, profileId);
    if (userRank !== null) {
      // Get full list to find user's entry
      const allEntries = await getTierProgressionLeaderboard(communityId, 1000);
      userEntry = allEntries.find((e) => e.profileId === profileId) ?? null;
    }
  }

  // Build and send embed
  const embed = buildTierProgressionEmbed(entries, userEntry);

  await discord.editOriginal(interactionToken, {
    embeds: [embed],
  });

  logger.info(
    {
      entriesCount: entries.length,
      hasUserEntry: userEntry !== null,
    },
    'Tier progression leaderboard served'
  );
}

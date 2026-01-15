/**
 * /position Command Handler
 *
 * Displays the user's current position in the eligibility ranking.
 * Shows distance to adjacent positions and entry threshold.
 *
 * Ephemeral - only visible to the user.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getPositionData,
} from '../../data/index.js';
import {
  buildPositionStatusEmbed,
  createErrorEmbed,
  type PositionStatusData,
} from '../../embeds/index.js';

/**
 * Handle /position command
 */
export function createPositionHandler(discord: DiscordRestService) {
  return async function handlePosition(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId } = payload;

    if (!interactionId || !interactionToken) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction credentials');
      return 'ack';
    }

    if (!userId) {
      logger.error({ eventId: payload.eventId }, 'Missing user ID');
      return 'ack';
    }

    if (!guildId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild ID');
      return 'ack';
    }

    const log = logger.child({ command: 'position', userId, guildId });

    try {
      // Step 1: Defer reply (ephemeral - private to user)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer reply');
        return 'ack';
      }

      // Step 2: Get community from guild ID
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured. Please contact an administrator.')],
        });
        return 'ack';
      }

      // Step 3: Get user's profile
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'You are not a member of the Sietch. Use `/onboard` to begin the onboarding process.'
          )],
        });
        return 'ack';
      }

      // Step 4: Get position data
      const positionData = await getPositionData(community.id, profile.id);
      if (!positionData) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'Could not find your position in the eligibility rankings. ' +
            'Your conviction score may be too low to rank.'
          )],
        });
        return 'ack';
      }

      // Step 5: Map to embed data format
      // Note: In the sietch version, this uses BGT amounts
      // Here we use conviction scores as the ranking metric
      const statusData: PositionStatusData = {
        position: positionData.position,
        bgt: positionData.convictionScore, // Using conviction as the metric
        distanceToAbove: positionData.distanceToAbove,
        distanceToBelow: positionData.distanceToBelow,
        distanceToEntry: positionData.distanceToEntry,
        isNaib: positionData.isNaib,
        isFedaykin: positionData.isFedaykin,
        isAtRisk: positionData.isAtRisk,
      };

      // Step 6: Send embed response
      const embed = buildPositionStatusEmbed(statusData);
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info(
        { memberId: profile.id, position: positionData.position, isFedaykin: positionData.isFedaykin },
        'Position served'
      );
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /position command');

      // Try to send error response if we deferred
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while loading your position. Please try again.')],
        });
      }

      return 'ack';
    }
  };
}

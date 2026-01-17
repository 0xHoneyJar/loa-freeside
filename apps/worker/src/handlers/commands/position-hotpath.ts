/**
 * /position Command Handler - Hot-Path Version
 * Sprint S-9: Hot-Path Migration
 *
 * Uses ScyllaDB via HotPathService for fast position lookups.
 * Falls back to PostgreSQL data layer for profile metadata.
 *
 * Changes from original:
 * - Position data from ScyllaDB leaderboard (via HotPathService)
 * - Profile lookup still from PostgreSQL (metadata)
 * - Metrics recorded via TenantMetrics
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import type { HotPathService } from '../../services/HotPathService.js';
import type { TenantContextManager } from '../../services/TenantContext.js';
import { getCommunityByGuildId, getProfileByDiscordId } from '../../data/index.js';
import {
  buildPositionStatusEmbed,
  createErrorEmbed,
  type PositionStatusData,
} from '../../embeds/index.js';

/**
 * Handle /position command using hot-path ScyllaDB
 */
export function createPositionHotPathHandler(
  discord: DiscordRestService,
  hotPath: HotPathService,
  tenantManager: TenantContextManager
) {
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

    const log = logger.child({ command: 'position', userId, guildId, hotPath: true });

    try {
      // Step 1: Defer reply (ephemeral - private to user)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer reply');
        return 'ack';
      }

      // Step 2: Get community from guild ID (PostgreSQL)
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured. Please contact an administrator.')],
        });
        return 'ack';
      }

      // Step 3: Get user's profile (PostgreSQL - profile metadata)
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'You are not a member of the Sietch. Use `/onboard` to begin the onboarding process.'
          )],
        });
        return 'ack';
      }

      // Step 4: Create tenant context for hot-path operations
      const ctx = await tenantManager.createContext(guildId, userId);

      // Step 5: Get position data from ScyllaDB via HotPathService
      const positionData = await hotPath.getPositionData(ctx, profile.id);
      if (!positionData) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'Could not find your position in the eligibility rankings. ' +
            'Your conviction score may be too low to rank.'
          )],
        });
        return 'ack';
      }

      // Step 6: Map to embed data format
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

      // Step 7: Send embed response
      const embed = buildPositionStatusEmbed(statusData);
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info(
        { memberId: profile.id, position: positionData.position, isFedaykin: positionData.isFedaykin },
        'Position served (hot-path)'
      );
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /position command (hot-path)');

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

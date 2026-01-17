/**
 * /admin-stats Command Handler
 *
 * Displays community analytics dashboard for administrators.
 * Shows member counts, tier distribution, activity metrics, and recent events.
 *
 * Admin only - requires administrator permissions.
 * Authorization verified server-side (Sprint SEC-1, Finding H-2).
 * Ephemeral - only visible to the admin.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import { requireAdministrator } from '../../utils/authorization.js';
import {
  getCommunityByGuildId,
  getCommunityAnalytics,
  getTierDistributionSummary,
  getTopActiveMembers,
  getRecentPromotions,
} from '../../data/index.js';
import {
  buildAdminStatsEmbed,
  createErrorEmbed,
} from '../../embeds/index.js';

/**
 * Handle /admin-stats command
 */
export function createAdminStatsHandler(discord: DiscordRestService) {
  return async function handleAdminStats(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId } = payload;

    if (!interactionId || !interactionToken) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction credentials');
      return 'ack';
    }

    if (!guildId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild ID');
      return 'ack';
    }

    const log = logger.child({ command: 'admin-stats', userId, guildId });

    try {
      // Step 1: Defer reply (ephemeral - private to admin)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer reply');
        return 'ack';
      }

      // Step 1.5: SEC-1.4: Server-side authorization check (Finding H-2)
      const authResult = requireAdministrator(payload);
      if (!authResult.authorized) {
        log.warn({ userId }, 'Unauthorized admin-stats attempt');
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(authResult.reason ?? 'Insufficient permissions.')],
        });
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

      // Step 3: Collect analytics data
      const [analytics, tierDistribution, topActive, recentPromotions] = await Promise.all([
        getCommunityAnalytics(community.id),
        getTierDistributionSummary(community.id),
        getTopActiveMembers(community.id, 5),
        getRecentPromotions(community.id, 5),
      ]);

      // Step 4: Build and send embed
      const embed = buildAdminStatsEmbed({
        analytics,
        tierDistribution,
        topActive,
        recentPromotions,
      });

      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info(
        {
          totalMembers: analytics.totalMembers,
          weeklyActive: analytics.weeklyActive,
          newThisWeek: analytics.newThisWeek,
        },
        'Admin stats served'
      );
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /admin-stats command');

      // Try to send error response if we deferred
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while generating analytics. Please check logs.')],
        });
      }

      return 'ack';
    }
  };
}

/**
 * /threshold Command Handler - Hot-Path Version
 * Sprint S-9: Hot-Path Migration
 *
 * Uses ScyllaDB via HotPathService for fast threshold lookups.
 *
 * Changes from original:
 * - Threshold data from ScyllaDB leaderboard (via HotPathService)
 * - Community lookup still from PostgreSQL
 * - Metrics recorded via TenantMetrics
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import type { HotPathService } from '../../services/HotPathService.js';
import type { TenantContextManager } from '../../services/TenantContext.js';
import { getCommunityByGuildId, getProfileByWallet } from '../../data/index.js';
import {
  buildThresholdEmbed,
  createErrorEmbed,
  type ThresholdData,
  type WaitlistPosition,
} from '../../embeds/index.js';

/**
 * Truncate wallet address for display: 0x1234...5678
 */
function truncateAddress(address: string): string {
  if (!address || address.length <= 10) return address || 'Unknown';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Handle /threshold command using hot-path ScyllaDB
 */
export function createThresholdHotPathHandler(
  discord: DiscordRestService,
  hotPath: HotPathService,
  tenantManager: TenantContextManager
) {
  return async function handleThreshold(
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

    const log = logger.child({ command: 'threshold', guildId, hotPath: true });

    try {
      // Step 1: Defer reply (public - visible to everyone)
      const deferResult = await discord.deferReply(interactionId, interactionToken, false);
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

      // Step 3: Create tenant context for hot-path operations
      const ctx = await tenantManager.createContext(guildId, userId);

      // Step 4: Get threshold data from ScyllaDB via HotPathService
      const thresholdData = await hotPath.getThresholdData(ctx);

      // Step 5: Get waitlist positions for display
      const waitlistPositions = await hotPath.getTopWaitlistPositions(ctx, 5);

      // Step 6: Map to embed data format
      const embedThresholdData: ThresholdData = {
        entryThreshold: thresholdData.entryThreshold,
        eligibleCount: thresholdData.eligibleCount,
        waitlistCount: thresholdData.waitlistCount,
        gapToEntry: thresholdData.gapToEntry,
        updatedAt: thresholdData.updatedAt,
      };

      // Map waitlist positions to embed format
      // Note: We'd need to enrich with wallet addresses from PostgreSQL profiles
      const embedWaitlist: WaitlistPosition[] = await Promise.all(
        waitlistPositions.map(async (pos) => {
          // For hot-path, we only have profileId - would need profile lookup for address
          // In production, this could be cached or denormalized in ScyllaDB
          return {
            position: pos.position,
            addressDisplay: `Profile #${pos.profileId.slice(-6)}`, // Fallback display
            bgt: pos.convictionScore,
            distanceToEntry: pos.distanceToEntry,
            isRegistered: false, // Would need waitlist registration check
          };
        })
      );

      // Step 7: Send embed response
      const embed = buildThresholdEmbed(embedThresholdData, embedWaitlist);
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info(
        {
          entryThreshold: thresholdData.entryThreshold,
          eligibleCount: thresholdData.eligibleCount,
          waitlistCount: thresholdData.waitlistCount,
        },
        'Threshold served (hot-path)'
      );
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /threshold command (hot-path)');

      // Try to send error response if we deferred
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while loading threshold data. Please try again.')],
        });
      }

      return 'ack';
    }
  };
}

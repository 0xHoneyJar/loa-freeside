/**
 * /threshold Command Handler
 *
 * Displays the current entry threshold for joining the Sietch.
 * Shows conviction requirement (position 69) and top waitlist positions.
 *
 * Public visibility - anyone can see entry requirements.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getThresholdData as getThresholdDataFromDb,
  getTopWaitlistPositions,
} from '../../data/index.js';
import {
  buildThresholdEmbed,
  createErrorEmbed,
  type ThresholdData,
  type WaitlistPosition,
} from '../../embeds/index.js';

/**
 * Handle /threshold command
 */
export function createThresholdHandler(discord: DiscordRestService) {
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

    const log = logger.child({ command: 'threshold', userId, guildId });

    try {
      // Step 1: Defer reply (public - visible to everyone)
      const deferResult = await discord.deferReply(interactionId, interactionToken, false);
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

      // Step 3: Get threshold data
      const thresholdData = await getThresholdDataFromDb(community.id);

      // Step 4: Get top waitlist positions
      const waitlistPositions = await getTopWaitlistPositions(community.id, 5);

      // Step 5: Map to embed format
      const embedThresholdData: ThresholdData = {
        entryThreshold: thresholdData.entryThreshold,
        eligibleCount: thresholdData.eligibleCount,
        waitlistCount: thresholdData.waitlistCount,
        gapToEntry: thresholdData.gapToEntry,
        updatedAt: thresholdData.updatedAt,
      };

      // Map waitlist positions to embed format
      const embedWaitlist: WaitlistPosition[] = waitlistPositions.map((pos) => {
        const metadata = pos.profile.metadata ?? {};
        const address = pos.profile.walletAddress ?? '';

        return {
          position: pos.position,
          addressDisplay: truncateAddress(address),
          bgt: pos.profile.convictionScore, // Using conviction as metric
          distanceToEntry: pos.distanceToEntry,
          isRegistered: false, // Would need waitlist registration check
        };
      });

      // Step 6: Send embed response
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
        'Threshold served'
      );
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /threshold command');

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

/**
 * Truncate wallet address for display: 0x1234...5678
 */
function truncateAddress(address: string): string {
  if (!address || address.length <= 10) return address || 'Unknown';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

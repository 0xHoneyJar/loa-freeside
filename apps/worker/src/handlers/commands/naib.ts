/**
 * /naib Command Handler
 *
 * Displays the Naib Council (top 7 BGT holders with seats).
 *
 * Subcommands:
 * - /naib overview - Shows council overview
 * - /naib current - Shows current Naib members in detail
 * - /naib former - Shows former Naib members (honor roll)
 *
 * Privacy notes:
 * - Does NOT expose wallet addresses
 * - Does NOT expose Discord IDs
 * - Only shows nyms, ranks, and tenure
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getCurrentNaib,
  getFormerNaib,
  getEmptyNaibSeatCount,
} from '../../data/index.js';
import {
  buildNaibOverviewEmbed,
  buildNaibCouncilEmbed,
  buildFormerNaibEmbed,
  createErrorEmbed,
} from '../../embeds/index.js';

/**
 * Handle /naib command
 */
export function createNaibHandler(discord: DiscordRestService) {
  return async function handleNaib(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, data } = payload;

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

    // Get subcommand (default to 'overview')
    const options = (data?.['options'] as Array<{ name: string }>) ?? [];
    const subcommand = options[0]?.name ?? 'overview';

    const log = logger.child({ command: 'naib', userId, guildId, subcommand });

    try {
      // Defer reply (public - Naib council is public information)
      await discord.deferReply(interactionId, interactionToken, false);

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured.')],
        });
        return 'ack';
      }

      // Check if user has completed onboarding
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile || !profile.tier) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              'You need to complete onboarding first to view the Naib Council. ' +
                'Check your DMs for the onboarding wizard.'
            ),
          ],
        });
        return 'ack';
      }

      // Get Naib data in parallel
      const [currentNaib, formerNaib, emptySeats] = await Promise.all([
        getCurrentNaib(community.id),
        getFormerNaib(community.id),
        getEmptyNaibSeatCount(community.id),
      ]);

      let embed;

      switch (subcommand) {
        case 'current':
          embed = buildNaibCouncilEmbed(currentNaib, emptySeats);
          break;

        case 'former':
          embed = buildFormerNaibEmbed(formerNaib);
          break;

        case 'overview':
        default:
          embed = buildNaibOverviewEmbed(currentNaib, formerNaib, emptySeats);
          break;
      }

      // Send public response
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info({ memberCount: currentNaib.length, formerCount: formerNaib.length }, 'Naib served');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /naib command');
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed('An error occurred while loading Naib Council data. Please try again.'),
          ],
        });
      }
      return 'ack';
    }
  };
}

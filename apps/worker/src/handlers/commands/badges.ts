/**
 * /badges Command Handler
 *
 * Displays earned badges for self (ephemeral) or another member (public).
 *
 * Usage:
 * - /badges - View your own badges (ephemeral)
 * - /badges [nym] - View another member's badges (public)
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getOwnBadges,
  getPublicBadges,
  searchProfilesByNym,
} from '../../data/index.js';
import {
  buildOwnBadgesEmbed,
  buildPublicBadgesEmbed,
  createErrorEmbed,
} from '../../embeds/index.js';

/**
 * Handle /badges command
 */
export function createBadgesHandler(discord: DiscordRestService) {
  return async function handleBadges(
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

    const log = logger.child({ command: 'badges', userId, guildId });

    // Get nym option if provided
    const options = (data?.['options'] as Array<{ name: string; value: string }>) ?? [];
    const nymOption = options.find((opt) => opt.name === 'nym');
    const targetNym = nymOption?.value;

    try {
      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.deferReply(interactionId, interactionToken, true);
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured.')],
        });
        return 'ack';
      }

      if (!targetNym) {
        // View own badges (ephemeral)
        await discord.deferReply(interactionId, interactionToken, true);

        const result = await getOwnBadges(community.id, userId);
        if (!result) {
          await discord.editOriginal(interactionToken, {
            embeds: [
              createErrorEmbed(
                "You haven't completed onboarding yet. " +
                  'Please complete the onboarding process first to view your badges.'
              ),
            ],
          });
          return 'ack';
        }

        const embed = buildOwnBadgesEmbed(result.nym, result.badges, result.pfpUrl);
        await discord.editOriginal(interactionToken, { embeds: [embed] });
        log.info({ badgeCount: result.badges.length }, 'Own badges viewed');
      } else {
        // View another member's badges (public - not ephemeral)
        await discord.deferReply(interactionId, interactionToken, false);

        const result = await getPublicBadges(community.id, targetNym);
        if (!result) {
          await discord.editOriginal(interactionToken, {
            embeds: [createErrorEmbed(`No member found with the nym "${targetNym}".`)],
          });
          return 'ack';
        }

        const embed = buildPublicBadgesEmbed(
          result.nym,
          result.badges,
          result.tier,
          result.pfpUrl
        );
        await discord.editOriginal(interactionToken, { embeds: [embed] });
        log.info({ targetNym, badgeCount: result.badges.length }, 'Public badges viewed');
      }

      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /badges command');
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while fetching badges. Please try again.')],
        });
      }
      return 'ack';
    }
  };
}

/**
 * Handle /badges autocomplete for nym parameter
 */
export function createBadgesAutocompleteHandler(discord: DiscordRestService) {
  return async function handleBadgesAutocomplete(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, data } = payload;

    if (!interactionId || !interactionToken) {
      return 'ack';
    }

    if (!guildId) {
      return 'ack';
    }

    const log = logger.child({ command: 'badges-autocomplete', guildId });

    try {
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        // Return empty choices
        await discord.respondAutocomplete(interactionId, interactionToken, []);
        return 'ack';
      }

      // Extract focused option value
      const options = (data?.['options'] as Array<{ name: string; value: string; focused?: boolean }>) ?? [];
      const focusedOption = options.find((opt) => opt.focused);
      const query = focusedOption?.value ?? '';

      const results = await searchProfilesByNym(community.id, query, 25);

      const choices = results.map((profile) => ({
        name: `${profile.nym} (${profile.tier === 'naib' ? '👑' : '⚔️'})`,
        value: profile.nym,
      }));

      await discord.respondAutocomplete(interactionId, interactionToken, choices);
      log.debug({ choiceCount: choices.length }, 'Badges autocomplete completed');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling badges autocomplete');
      // Return empty choices on error
      await discord.respondAutocomplete(interactionId, interactionToken, []);
      return 'ack';
    }
  };
}

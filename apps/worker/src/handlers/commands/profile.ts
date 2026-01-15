/**
 * /profile Command Handler
 *
 * Handles /profile view [nym] and /profile edit subcommands.
 * - view: Show own profile (ephemeral) or public profile (visible)
 * - edit: Send DM with profile editing instructions
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getOwnProfile,
  getPublicProfile,
  getProfileByDiscordId,
  searchProfilesByNym,
} from '../../data/index.js';
import {
  buildOwnProfileEmbed,
  buildPublicProfileEmbed,
  createErrorEmbed,
} from '../../embeds/index.js';

/**
 * Handle /profile command
 */
export function createProfileHandler(discord: DiscordRestService) {
  return async function handleProfile(
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

    const log = logger.child({ command: 'profile', userId, guildId });

    // Get subcommand from payload data
    const options = (data?.['options'] as Array<{ name: string; options?: Array<{ name: string; value: string }> }>) ?? [];
    const subcommand = options[0]?.name ?? 'view';

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

      switch (subcommand) {
        case 'view':
          return await handleProfileView(
            discord,
            payload,
            community.id,
            userId,
            options[0]?.options ?? [],
            log
          );
        case 'edit':
          return await handleProfileEdit(discord, payload, community.id, userId, log);
        default:
          await discord.deferReply(interactionId, interactionToken, true);
          await discord.editOriginal(interactionToken, {
            embeds: [createErrorEmbed('Unknown subcommand.')],
          });
          return 'ack';
      }
    } catch (error) {
      log.error({ error }, 'Error handling /profile command');
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred. Please try again.')],
        });
      }
      return 'ack';
    }
  };
}

/**
 * Handle /profile view [nym]
 */
async function handleProfileView(
  discord: DiscordRestService,
  payload: DiscordEventPayload,
  communityId: string,
  userId: string,
  options: Array<{ name: string; value: string }>,
  log: Logger
): Promise<ConsumeResult> {
  const { interactionId, interactionToken } = payload;

  if (!interactionId || !interactionToken) return 'ack';

  // Get nym option if provided
  const nymOption = options.find((opt) => opt.name === 'nym');
  const targetNym = nymOption?.value;

  if (!targetNym) {
    // View own profile (ephemeral)
    await discord.deferReply(interactionId, interactionToken, true);

    const ownProfile = await getOwnProfile(communityId, userId);
    if (!ownProfile) {
      await discord.editOriginal(interactionToken, {
        embeds: [
          createErrorEmbed(
            "You haven't completed onboarding yet. " +
              "When you gain access, you'll receive a DM to set up your profile."
          ),
        ],
      });
      return 'ack';
    }

    const embed = buildOwnProfileEmbed(ownProfile);
    await discord.editOriginal(interactionToken, { embeds: [embed] });
    log.info({ profileId: ownProfile.profileId }, 'Own profile viewed');
  } else {
    // View another member's profile (public - not ephemeral)
    await discord.deferReply(interactionId, interactionToken, false);

    const publicProfile = await getPublicProfile(communityId, targetNym);
    if (!publicProfile) {
      await discord.editOriginal(interactionToken, {
        embeds: [createErrorEmbed(`No member found with nym "${targetNym}".`)],
      });
      return 'ack';
    }

    const embed = buildPublicProfileEmbed(publicProfile);
    await discord.editOriginal(interactionToken, { embeds: [embed] });
    log.info({ targetNym, profileId: publicProfile.profileId }, 'Public profile viewed');
  }

  return 'ack';
}

/**
 * Handle /profile edit
 */
async function handleProfileEdit(
  discord: DiscordRestService,
  payload: DiscordEventPayload,
  communityId: string,
  userId: string,
  log: Logger
): Promise<ConsumeResult> {
  const { interactionId, interactionToken } = payload;

  if (!interactionId || !interactionToken) return 'ack';

  await discord.deferReply(interactionId, interactionToken, true);

  // Check if user has a profile
  const profile = await getProfileByDiscordId(communityId, userId);
  if (!profile) {
    await discord.editOriginal(interactionToken, {
      embeds: [
        createErrorEmbed(
          "You haven't completed onboarding yet. " +
            "When you gain access, you'll receive a DM to set up your profile."
        ),
      ],
    });
    return 'ack';
  }

  // Get nym from metadata
  const nym =
    profile.metadata?.displayName ?? profile.metadata?.username ?? `User#${userId.slice(-4)}`;
  const bio = profile.metadata?.bio ?? '_Not set_';

  // Send DM with edit instructions
  try {
    await discord.sendDM(userId, {
      content:
        `🔧 **Profile Edit**\n\n` +
        `To edit your profile, reply with one of these commands:\n\n` +
        `• \`!bio <your new bio>\` - Update your bio\n` +
        `• \`!nym <new nym>\` - Request a nym change (subject to approval)\n\n` +
        `Current nym: **${nym}**\nCurrent bio: ${bio}`,
    });

    await discord.editOriginal(interactionToken, {
      content: "Check your DMs! I've sent you a message to edit your profile.",
    });

    log.info({ profileId: profile.id }, 'Profile edit DM sent');
  } catch (dmError) {
    log.warn({ error: dmError, userId }, 'Could not send profile edit DM');
    await discord.editOriginal(interactionToken, {
      embeds: [
        createErrorEmbed(
          "I couldn't send you a DM. Please enable DMs from server members and try again."
        ),
      ],
    });
  }

  return 'ack';
}

/**
 * Handle /profile autocomplete for nym parameter
 */
export function createProfileAutocompleteHandler(discord: DiscordRestService) {
  return async function handleProfileAutocomplete(
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

    const log = logger.child({ command: 'profile-autocomplete', guildId });

    try {
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        // Return empty choices
        await discord.respondAutocomplete(interactionId, interactionToken, []);
        return 'ack';
      }

      // Extract focused option value from nested subcommand options
      const options = (data?.['options'] as Array<{ options?: Array<{ name: string; value: string; focused?: boolean }> }>) ?? [];
      const subcommandOptions = options[0]?.options ?? [];
      const focusedOption = subcommandOptions.find((opt) => opt.focused);
      const query = focusedOption?.value ?? '';

      const results = await searchProfilesByNym(community.id, query, 25);

      const choices = results.map((profile) => ({
        name: `${profile.nym} (${profile.tier === 'naib' ? '👑' : '⚔️'})`,
        value: profile.nym,
      }));

      await discord.respondAutocomplete(interactionId, interactionToken, choices);
      log.debug({ choiceCount: choices.length }, 'Profile autocomplete completed');

      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling profile autocomplete');
      // Return empty choices on error
      await discord.respondAutocomplete(interactionId, interactionToken, []);
      return 'ack';
    }
  };
}

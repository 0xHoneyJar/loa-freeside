/**
 * /admin-badge Command Handler
 *
 * Admin command to award or revoke badges from members.
 *
 * Subcommands:
 * - /admin-badge award [nym] [badge] [reason] - Award a badge
 * - /admin-badge revoke [nym] [badge] - Revoke a badge
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
  getProfileByDiscordId,
  getProfileByNym,
  searchProfilesByNym,
  getAllBadgeDefinitions,
  profileHasBadge,
  awardBadge,
  revokeBadge,
  getProfileBadgesByType,
} from '../../data/index.js';
import { createErrorEmbed, createSuccessEmbed } from '../../embeds/index.js';

/**
 * Handle /admin-badge command
 */
export function createAdminBadgeHandler(discord: DiscordRestService) {
  return async function handleAdminBadge(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, data } = payload;

    if (!interactionId || !interactionToken) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction credentials');
      return 'ack';
    }

    if (!guildId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild ID');
      return 'ack';
    }

    const log = logger.child({ command: 'admin-badge', userId, guildId });

    try {
      // Get subcommand and options
      const options = (data?.['options'] as Array<{
        name: string;
        options?: Array<{ name: string; value: string }>;
      }>) ?? [];

      const subcommandOption = options[0];
      if (!subcommandOption) {
        await discord.deferReply(interactionId, interactionToken, true);
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('No subcommand provided.')],
        });
        return 'ack';
      }

      const subcommand = subcommandOption.name;
      const subOptions = subcommandOption.options ?? [];

      // Parse options
      const nym = subOptions.find(o => o.name === 'nym')?.value;
      const badgeId = subOptions.find(o => o.name === 'badge')?.value;
      const reason = subOptions.find(o => o.name === 'reason')?.value;

      // Defer reply (ephemeral - private to admin)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer reply');
        return 'ack';
      }

      // SEC-1.3: Server-side authorization check (Finding H-2)
      const authResult = requireAdministrator(payload);
      if (!authResult.authorized) {
        log.warn({ userId }, 'Unauthorized admin-badge attempt');
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(authResult.reason ?? 'Insufficient permissions.')],
        });
        return 'ack';
      }

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured.')],
        });
        return 'ack';
      }

      switch (subcommand) {
        case 'award':
          await handleAward(discord, interactionToken, community.id, userId!, nym, badgeId, reason, log);
          break;
        case 'revoke':
          await handleRevoke(discord, interactionToken, community.id, userId!, nym, badgeId, log);
          break;
        default:
          await discord.editOriginal(interactionToken, {
            embeds: [createErrorEmbed(`Unknown subcommand: ${subcommand}`)],
          });
      }

      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /admin-badge command');

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
 * Handle award subcommand
 */
async function handleAward(
  discord: DiscordRestService,
  interactionToken: string,
  communityId: string,
  adminUserId: string,
  nym: string | undefined,
  badgeId: string | undefined,
  reason: string | undefined,
  logger: Logger
): Promise<void> {
  if (!nym || !badgeId || !reason) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed('Missing required options: nym, badge, or reason.')],
    });
    return;
  }

  // Find the target member
  const profile = await getProfileByNym(communityId, nym);
  if (!profile) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`No member found with the nym "${nym}".`)],
    });
    return;
  }

  // Get badge definition
  const badges = await getAllBadgeDefinitions(communityId);
  const badge = badges.find(b => b.badgeId === badgeId);

  if (!badge) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`Badge "${badgeId}" not found.`)],
    });
    return;
  }

  // Check category - only contribution/special badges can be manually awarded
  if (badge.category !== 'contribution' && badge.category !== 'special') {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(
        `Cannot manually award "${badge.name}". Only contribution and special badges can be awarded by admins.`
      )],
    });
    return;
  }

  // Check if already has badge
  const hasBadge = await profileHasBadge(profile.id, badgeId);
  if (hasBadge) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`${nym} already has the "${badge.name}" badge.`)],
    });
    return;
  }

  // Look up admin's profile to get their profile ID for attribution
  const adminProfile = await getProfileByDiscordId(communityId, adminUserId);

  // Award the badge (adminProfile.id can be null if admin doesn't have a profile)
  const result = await awardBadge(communityId, profile.id, badgeId, adminProfile?.id ?? null, reason);

  if (!result) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`Could not award "${badge.name}" to ${nym}.`)],
    });
    return;
  }

  // Success response
  await discord.editOriginal(interactionToken, {
    embeds: [createSuccessEmbed(
      `Awarded **${badge.emoji ?? '🏆'} ${badge.name}** to **${nym}**.\n*Reason: ${reason}*`
    )],
  });

  logger.info({ profileId: profile.id, badgeId, reason }, 'Admin awarded badge');
}

/**
 * Handle revoke subcommand
 */
async function handleRevoke(
  discord: DiscordRestService,
  interactionToken: string,
  communityId: string,
  adminUserId: string,
  nym: string | undefined,
  badgeId: string | undefined,
  logger: Logger
): Promise<void> {
  if (!nym || !badgeId) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed('Missing required options: nym or badge.')],
    });
    return;
  }

  // Find the target member
  const profile = await getProfileByNym(communityId, nym);
  if (!profile) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`No member found with the nym "${nym}".`)],
    });
    return;
  }

  // Get badge definition
  const badges = await getAllBadgeDefinitions(communityId);
  const badge = badges.find(b => b.badgeId === badgeId);

  if (!badge) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`Badge "${badgeId}" not found.`)],
    });
    return;
  }

  // Check if has badge
  const hasBadge = await profileHasBadge(profile.id, badgeId);
  if (!hasBadge) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`${nym} does not have the "${badge.name}" badge.`)],
    });
    return;
  }

  // Revoke the badge
  const success = await revokeBadge(profile.id, badgeId);

  if (!success) {
    await discord.editOriginal(interactionToken, {
      embeds: [createErrorEmbed(`Could not revoke "${badge.name}" from ${nym}.`)],
    });
    return;
  }

  // Success response
  await discord.editOriginal(interactionToken, {
    embeds: [createSuccessEmbed(`Revoked **${badge.emoji ?? '🏆'} ${badge.name}** from **${nym}**.`)],
  });

  logger.info({ profileId: profile.id, badgeId }, 'Admin revoked badge');
}

/**
 * Handle autocomplete for nym and badge parameters
 */
export function createAdminBadgeAutocompleteHandler(discord: DiscordRestService) {
  return async function handleAdminBadgeAutocomplete(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, data } = payload;

    if (!interactionId || !interactionToken) {
      logger.warn('Missing interaction credentials for autocomplete');
      return 'ack';
    }

    if (!guildId) {
      logger.warn('Missing guild ID for autocomplete');
      return 'ack';
    }

    try {
      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.respondAutocomplete(interactionId, interactionToken, []);
        return 'ack';
      }

      // Parse options to find focused option
      const options = (data?.['options'] as Array<{
        name: string;
        options?: Array<{ name: string; value: string; focused?: boolean }>;
      }>) ?? [];

      const subcommandOption = options[0];
      if (!subcommandOption) {
        await discord.respondAutocomplete(interactionId, interactionToken, []);
        return 'ack';
      }

      const subcommand = subcommandOption.name;
      const subOptions = subcommandOption.options ?? [];
      const focusedOption = subOptions.find(o => o.focused);

      if (!focusedOption) {
        await discord.respondAutocomplete(interactionId, interactionToken, []);
        return 'ack';
      }

      if (focusedOption.name === 'nym') {
        // Search for members by nym
        const results = await searchProfilesByNym(community.id, focusedOption.value, 25);

        const choices = results.map(profile => ({
          name: `${profile.nym} (${profile.tier === 'naib' ? '👑' : '⚔️'})`,
          value: profile.nym,
        }));

        await discord.respondAutocomplete(interactionId, interactionToken, choices);
      } else if (focusedOption.name === 'badge') {
        // Get badge definitions
        let badges = await getAllBadgeDefinitions(community.id);

        if (subcommand === 'award') {
          // Only show contribution/special badges for award
          badges = badges.filter(b => b.category === 'contribution' || b.category === 'special');
        } else if (subcommand === 'revoke') {
          // For revoke, try to show badges the member has
          const nym = subOptions.find(o => o.name === 'nym')?.value;
          if (nym) {
            const profile = await getProfileByNym(community.id, nym);
            if (profile) {
              const memberBadgeTypes = await getProfileBadgesByType(profile.id);
              const memberBadgeSet = new Set(memberBadgeTypes);
              badges = badges.filter(b => memberBadgeSet.has(b.badgeId));
            }
          }
        }

        // Filter by search query
        const query = focusedOption.value.toLowerCase();
        const filtered = badges.filter(
          b => b.name.toLowerCase().includes(query) || b.badgeId.toLowerCase().includes(query)
        );

        const choices = filtered.slice(0, 25).map(badge => ({
          name: `${badge.emoji ?? '🏆'} ${badge.name} (${badge.category})`,
          value: badge.badgeId,
        }));

        await discord.respondAutocomplete(interactionId, interactionToken, choices);
      } else {
        await discord.respondAutocomplete(interactionId, interactionToken, []);
      }

      return 'ack';
    } catch (error) {
      logger.error({ error }, 'Error handling admin-badge autocomplete');
      await discord.respondAutocomplete(interactionId, interactionToken, []);
      return 'ack';
    }
  };
}

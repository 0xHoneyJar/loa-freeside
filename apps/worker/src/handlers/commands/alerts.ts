/**
 * /alerts Command Handler
 *
 * Manages notification preferences for the user.
 * Shows current settings and provides toggles for each alert type.
 *
 * Ephemeral visibility - only the user can see their settings.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getNotificationPreferences,
  isProfileNaib,
  updateNotificationPreferences,
  type AlertFrequency,
} from '../../data/index.js';
import {
  buildAlertsEmbed,
  buildAlertsComponents,
  ALERT_INTERACTIONS,
  createErrorEmbed,
} from '../../embeds/index.js';

/**
 * Handle /alerts command
 */
export function createAlertsHandler(discord: DiscordRestService) {
  return async function handleAlerts(
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

    const log = logger.child({ command: 'alerts', userId, guildId });

    try {
      // Defer reply (ephemeral - private to user)
      await discord.deferReply(interactionId, interactionToken, true);

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured.')],
        });
        return 'ack';
      }

      // Get member profile
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              '❌ You are not a member of the Sietch. Use `/onboard` to begin the onboarding process.'
            ),
          ],
        });
        return 'ack';
      }

      // Get notification preferences and naib status
      const prefs = await getNotificationPreferences(profile.id);
      const isNaib = await isProfileNaib(community.id, profile.id);

      // Build embed and components
      const embed = buildAlertsEmbed(prefs, isNaib);
      const components = buildAlertsComponents(prefs, isNaib, profile.id);

      await discord.editOriginal(interactionToken, {
        embeds: [embed],
        components,
      });

      log.info({ profileId: profile.id }, 'Alerts preferences served');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /alerts command');
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed('An error occurred while loading your preferences. Please try again.'),
          ],
        });
      }
      return 'ack';
    }
  };
}

/**
 * Handle alerts toggle buttons
 */
export function createAlertsButtonHandler(discord: DiscordRestService) {
  return async function handleAlertsButton(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, customId } = payload;

    if (!interactionId || !interactionToken || !customId) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction data');
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

    const log = logger.child({ command: 'alerts-button', userId, customId });

    try {
      // Defer update (acknowledges without adding response)
      await discord.deferUpdate(interactionId, interactionToken);

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        return 'ack';
      }

      // Extract profile ID and action from custom_id
      // Format: alerts_toggle_{type}_{profileId} or alerts_disable_all_{profileId}
      const parts = customId.split('_');
      const profileId = parts[parts.length - 1];
      const action = parts.slice(0, -1).join('_');

      // Verify user owns this profile
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile || profile.id !== profileId) {
        log.warn({ profileId, actualProfileId: profile?.id }, 'Profile mismatch');
        return 'ack';
      }

      // Get current preferences
      const prefs = await getNotificationPreferences(profileId);

      // Handle action
      let updatedPrefs = { ...prefs };

      switch (action) {
        case ALERT_INTERACTIONS.togglePosition:
          updatedPrefs.positionUpdates = !prefs.positionUpdates;
          break;
        case ALERT_INTERACTIONS.toggleAtRisk:
          updatedPrefs.atRiskWarnings = !prefs.atRiskWarnings;
          break;
        case ALERT_INTERACTIONS.toggleNaib:
          updatedPrefs.naibAlerts = !prefs.naibAlerts;
          break;
        case ALERT_INTERACTIONS.disableAll:
          updatedPrefs.positionUpdates = false;
          updatedPrefs.atRiskWarnings = false;
          updatedPrefs.naibAlerts = false;
          break;
        default:
          log.warn({ action }, 'Unknown alert action');
          return 'ack';
      }

      // Save updated preferences
      await updateNotificationPreferences(profileId, updatedPrefs);

      // Rebuild embed and components with updated state
      const isNaib = await isProfileNaib(community.id, profileId);
      const embed = buildAlertsEmbed(updatedPrefs, isNaib);
      const components = buildAlertsComponents(updatedPrefs, isNaib, profileId);

      // Update the original message
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
        components,
      });

      log.info({ action, profileId }, 'Alert preference updated');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling alerts button');
      return 'ack';
    }
  };
}

/**
 * Handle alerts frequency select menu
 */
export function createAlertsSelectHandler(discord: DiscordRestService) {
  return async function handleAlertsSelect(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, customId, selectedValues } = payload;

    if (!interactionId || !interactionToken || !customId) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction data');
      return 'ack';
    }

    if (!userId || !selectedValues || selectedValues.length === 0) {
      logger.error({ eventId: payload.eventId }, 'Missing user ID or selection');
      return 'ack';
    }

    if (!guildId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild ID');
      return 'ack';
    }

    const log = logger.child({ command: 'alerts-select', userId, customId });

    try {
      // Defer update
      await discord.deferUpdate(interactionId, interactionToken);

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        return 'ack';
      }

      // Extract profile ID from custom_id
      // Format: alerts_frequency_{profileId}
      const parts = customId.split('_');
      const profileId = parts[parts.length - 1];

      // Verify user owns this profile
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile || profile.id !== profileId) {
        log.warn({ profileId, actualProfileId: profile?.id }, 'Profile mismatch');
        return 'ack';
      }

      // Get current preferences and update frequency
      const prefs = await getNotificationPreferences(profileId);
      const newFrequency = selectedValues[0] as AlertFrequency;

      const updatedPrefs = {
        ...prefs,
        frequency: newFrequency,
      };

      // Save updated preferences
      await updateNotificationPreferences(profileId, updatedPrefs);

      // Rebuild embed and components with updated state
      const isNaib = await isProfileNaib(community.id, profileId);
      const embed = buildAlertsEmbed(updatedPrefs, isNaib);
      const components = buildAlertsComponents(updatedPrefs, isNaib, profileId);

      // Update the original message
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
        components,
      });

      log.info({ newFrequency, profileId }, 'Alert frequency updated');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling alerts select');
      return 'ack';
    }
  };
}

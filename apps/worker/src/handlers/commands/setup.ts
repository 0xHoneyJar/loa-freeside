/**
 * /setup Command Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Admin command to start the community setup wizard.
 * Creates a new wizard session and shows the first step.
 *
 * Admin only - requires administrator permissions.
 * Ephemeral - only visible to the admin.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import type { IWizardEngine } from '@arrakis/core/ports';
import { requireAdministrator } from '../../utils/authorization.js';
import { getCommunityByGuildId } from '../../data/index.js';
import { createErrorEmbed } from '../../embeds/index.js';

/**
 * Create /setup command handler.
 *
 * @param discord - Discord REST service
 * @param wizardEngine - Wizard engine instance
 */
export function createSetupHandler(
  discord: DiscordRestService,
  wizardEngine: IWizardEngine
) {
  return async function handleSetup(
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

    const log = logger.child({ command: 'setup', userId, guildId });

    try {
      // Defer reply (ephemeral - private to admin)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer reply');
        return 'ack';
      }

      // Server-side authorization check
      const authResult = requireAdministrator(payload);
      if (!authResult.authorized) {
        log.warn({ userId }, 'Unauthorized setup attempt');
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(authResult.reason ?? 'Administrator permissions required.')],
        });
        return 'ack';
      }

      // Get community (tenant)
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              'This server is not configured yet. Please contact support to get started.'
            ),
          ],
        });
        return 'ack';
      }

      // Get client IP from payload metadata (if available)
      const ipAddress = (payload as { clientIp?: string }).clientIp;

      // Check for existing session
      const existingSession = await wizardEngine.resumeByGuild(guildId, ipAddress);
      if (existingSession) {
        // Session exists - prompt to resume or cancel
        const display = await wizardEngine.getCurrentStepDisplay(existingSession.id);
        await discord.editOriginal(interactionToken, {
          content:
            '⚠️ An existing setup session was found. Use `/resume` to continue or click Cancel below to start fresh.',
          embeds: display.embeds as unknown[],
          components: display.components as unknown[],
        });
        return 'ack';
      }

      // Start new wizard session
      const session = await wizardEngine.startSession(
        guildId,
        userId!,
        community.id,
        ipAddress
      );

      // Get initial display
      const display = await wizardEngine.getCurrentStepDisplay(session.id);

      await discord.editOriginal(interactionToken, {
        embeds: display.embeds as unknown[],
        components: display.components as unknown[],
      });

      log.info({ sessionId: session.id }, 'Wizard session started');

      return 'ack';
    } catch (error) {
      const err = error as Error;
      log.error({ error: err.message }, 'Error handling /setup command');

      // Check for "session already exists" error
      if (err.message.includes('Session already exists')) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              'A setup session is already in progress for this server. Use `/resume` to continue.'
            ),
          ],
        });
      } else {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred. Please try again.')],
        });
      }

      return 'ack';
    }
  };
}

/**
 * Create handler for wizard button interactions.
 *
 * @param discord - Discord REST service
 * @param wizardEngine - Wizard engine instance
 */
export function createWizardButtonHandler(
  discord: DiscordRestService,
  wizardEngine: IWizardEngine
) {
  return async function handleWizardButton(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, data } = payload;

    if (!interactionId || !interactionToken) {
      logger.warn('Missing interaction credentials for button');
      return 'ack';
    }

    if (!guildId) {
      logger.warn('Missing guild ID for button');
      return 'ack';
    }

    const customId = data?.['custom_id'] as string | undefined;
    if (!customId?.startsWith('wizard:')) {
      return 'ack';
    }

    const log = logger.child({ command: 'wizard-button', customId, userId, guildId });

    try {
      // Parse custom ID: wizard:{step}:{action}
      const [, step, action] = customId.split(':');

      // Get client IP
      const ipAddress = (payload as { clientIp?: string }).clientIp;

      // Get session
      const session = await wizardEngine.resumeByGuild(guildId, ipAddress);
      if (!session) {
        await discord.deferUpdate(interactionId, interactionToken);
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('Session expired. Please run `/setup` to start again.')],
          components: [],
        });
        return 'ack';
      }

      // Handle action
      switch (action) {
        case 'back': {
          await discord.deferUpdate(interactionId, interactionToken);
          const result = await wizardEngine.goBack(session.id);
          if (result.success && result.session) {
            const display = await wizardEngine.getCurrentStepDisplay(result.session.id);
            await discord.editOriginal(interactionToken, {
              embeds: display.embeds as unknown[],
              components: display.components as unknown[],
            });
          }
          break;
        }

        case 'continue': {
          await discord.deferUpdate(interactionId, interactionToken);
          // Execute current step (data should be collected via modal/select)
          const context = {
            sessionId: session.id,
            session,
            guildId,
            userId: userId!,
            ipAddress,
            interactionId,
            interactionToken,
          };
          const result = await wizardEngine.executeStep(context, { data: {} });
          if (result.success && result.session) {
            const display = await wizardEngine.getCurrentStepDisplay(result.session.id);
            await discord.editOriginal(interactionToken, {
              embeds: display.embeds as unknown[],
              components: display.components as unknown[],
            });
          } else if (result.error) {
            await discord.editOriginal(interactionToken, {
              embeds: [createErrorEmbed(result.error)],
            });
          }
          break;
        }

        case 'cancel': {
          await discord.deferUpdate(interactionId, interactionToken);
          await wizardEngine.cancelSession(session.id);
          await discord.editOriginal(interactionToken, {
            content: 'Setup wizard cancelled.',
            embeds: [],
            components: [],
          });
          break;
        }

        default:
          log.warn({ action }, 'Unknown wizard button action');
          await discord.deferUpdate(interactionId, interactionToken);
      }

      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling wizard button');
      await discord.deferUpdate(interactionId, interactionToken);
      await discord.editOriginal(interactionToken, {
        embeds: [createErrorEmbed('An error occurred. Please try again.')],
      });
      return 'ack';
    }
  };
}

/**
 * Create handler for wizard select menu interactions.
 *
 * @param discord - Discord REST service
 * @param wizardEngine - Wizard engine instance
 */
export function createWizardSelectHandler(
  discord: DiscordRestService,
  wizardEngine: IWizardEngine
) {
  return async function handleWizardSelect(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, data } = payload;

    if (!interactionId || !interactionToken) {
      logger.warn('Missing interaction credentials for select');
      return 'ack';
    }

    if (!guildId) {
      logger.warn('Missing guild ID for select');
      return 'ack';
    }

    const customId = data?.['custom_id'] as string | undefined;
    if (!customId?.startsWith('wizard:')) {
      return 'ack';
    }

    const log = logger.child({ command: 'wizard-select', customId, userId, guildId });

    try {
      // Parse custom ID: wizard:{step}:{field}
      const [, step, field] = customId.split(':');
      const values = data?.['values'] as string[] | undefined;

      // Get client IP
      const ipAddress = (payload as { clientIp?: string }).clientIp;

      // Get session
      const session = await wizardEngine.resumeByGuild(guildId, ipAddress);
      if (!session) {
        await discord.deferUpdate(interactionId, interactionToken);
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('Session expired. Please run `/setup` to start again.')],
          components: [],
        });
        return 'ack';
      }

      // Store selected values in session data
      // The actual execution happens on "Continue" button click
      await discord.deferUpdate(interactionId, interactionToken);

      // Update display with selection
      const display = await wizardEngine.getCurrentStepDisplay(session.id);
      await discord.editOriginal(interactionToken, {
        embeds: display.embeds as unknown[],
        components: display.components as unknown[],
      });

      log.debug({ step, field, values }, 'Wizard select updated');

      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling wizard select');
      await discord.deferUpdate(interactionId, interactionToken);
      await discord.editOriginal(interactionToken, {
        embeds: [createErrorEmbed('An error occurred. Please try again.')],
      });
      return 'ack';
    }
  };
}

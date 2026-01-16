/**
 * /resume Command Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Admin command to resume an existing wizard session.
 * Retrieves the session and shows the current step.
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
import { createErrorEmbed, createSuccessEmbed } from '../../embeds/index.js';

/**
 * Create /resume command handler.
 *
 * @param discord - Discord REST service
 * @param wizardEngine - Wizard engine instance
 */
export function createResumeHandler(
  discord: DiscordRestService,
  wizardEngine: IWizardEngine
) {
  return async function handleResume(
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

    const log = logger.child({ command: 'resume', userId, guildId });

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
        log.warn({ userId }, 'Unauthorized resume attempt');
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
              'This server is not configured. Please contact support to get started.'
            ),
          ],
        });
        return 'ack';
      }

      // Get client IP from payload metadata (if available)
      const ipAddress = (payload as { clientIp?: string }).clientIp;

      // Resume session
      const session = await wizardEngine.resumeByGuild(guildId, ipAddress);
      if (!session) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            createErrorEmbed(
              'No active setup session found. Use `/setup` to start a new session.'
            ),
          ],
        });
        return 'ack';
      }

      // Get current step display
      const display = await wizardEngine.getCurrentStepDisplay(session.id);

      await discord.editOriginal(interactionToken, {
        content: '✅ Session resumed successfully!',
        embeds: display.embeds as unknown[],
        components: display.components as unknown[],
      });

      log.info({ sessionId: session.id, state: session.state }, 'Wizard session resumed');

      return 'ack';
    } catch (error) {
      const err = error as Error;
      log.error({ error: err.message }, 'Error handling /resume command');

      await discord.editOriginal(interactionToken, {
        embeds: [createErrorEmbed('An error occurred. Please try again.')],
      });

      return 'ack';
    }
  };
}

/**
 * Create /cancel-setup command handler.
 *
 * @param discord - Discord REST service
 * @param wizardEngine - Wizard engine instance
 */
export function createCancelSetupHandler(
  discord: DiscordRestService,
  wizardEngine: IWizardEngine
) {
  return async function handleCancelSetup(
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

    const log = logger.child({ command: 'cancel-setup', userId, guildId });

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
        log.warn({ userId }, 'Unauthorized cancel-setup attempt');
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(authResult.reason ?? 'Administrator permissions required.')],
        });
        return 'ack';
      }

      // Get client IP from payload metadata (if available)
      const ipAddress = (payload as { clientIp?: string }).clientIp;

      // Get session
      const session = await wizardEngine.resumeByGuild(guildId, ipAddress);
      if (!session) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('No active setup session found.')],
        });
        return 'ack';
      }

      // Cancel session
      const cancelled = await wizardEngine.cancelSession(session.id);

      if (cancelled) {
        await discord.editOriginal(interactionToken, {
          embeds: [createSuccessEmbed('Setup session cancelled. Use `/setup` to start a new session.')],
        });
        log.info({ sessionId: session.id }, 'Wizard session cancelled by command');
      } else {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('Failed to cancel session.')],
        });
      }

      return 'ack';
    } catch (error) {
      const err = error as Error;
      log.error({ error: err.message }, 'Error handling /cancel-setup command');

      await discord.editOriginal(interactionToken, {
        embeds: [createErrorEmbed('An error occurred. Please try again.')],
      });

      return 'ack';
    }
  };
}

/**
 * Create /setup-status command handler.
 *
 * @param discord - Discord REST service
 * @param wizardEngine - Wizard engine instance
 */
export function createSetupStatusHandler(
  discord: DiscordRestService,
  wizardEngine: IWizardEngine
) {
  return async function handleSetupStatus(
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

    const log = logger.child({ command: 'setup-status', userId, guildId });

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
        log.warn({ userId }, 'Unauthorized setup-status attempt');
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(authResult.reason ?? 'Administrator permissions required.')],
        });
        return 'ack';
      }

      // Get client IP from payload metadata (if available)
      const ipAddress = (payload as { clientIp?: string }).clientIp;

      // Get session
      const session = await wizardEngine.resumeByGuild(guildId, ipAddress);

      if (!session) {
        await discord.editOriginal(interactionToken, {
          embeds: [
            {
              title: 'Setup Status',
              description: 'No active setup session.',
              color: 0x95a5a6,
              fields: [
                {
                  name: 'Action',
                  value: 'Use `/setup` to start a new session.',
                  inline: false,
                },
              ],
            },
          ],
        });
        return 'ack';
      }

      // Get deployment status if in DEPLOY state
      let deploymentInfo = '';
      if (session.data.synthesisJobId) {
        const deployStatus = await wizardEngine.getDeploymentStatus(session.id);
        deploymentInfo = `\n**Deployment:** ${deployStatus.status} (${deployStatus.progress}%)`;
      }

      await discord.editOriginal(interactionToken, {
        embeds: [
          {
            title: 'Setup Status',
            description: `Session active for this server.${deploymentInfo}`,
            color: 0x5865f2,
            fields: [
              {
                name: 'Session ID',
                value: `\`${session.id.slice(0, 8)}...\``,
                inline: true,
              },
              {
                name: 'Current Step',
                value: session.state,
                inline: true,
              },
              {
                name: 'Started By',
                value: `<@${session.userId}>`,
                inline: true,
              },
              {
                name: 'Expires',
                value: `<t:${Math.floor(session.expiresAt.getTime() / 1000)}:R>`,
                inline: true,
              },
            ],
            footer: {
              text: 'Use /resume to continue setup or /cancel-setup to start over',
            },
          },
        ],
      });

      return 'ack';
    } catch (error) {
      const err = error as Error;
      log.error({ error: err.message }, 'Error handling /setup-status command');

      await discord.editOriginal(interactionToken, {
        embeds: [createErrorEmbed('An error occurred. Please try again.')],
      });

      return 'ack';
    }
  };
}

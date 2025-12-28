/**
 * /onboard Command - Start Community Setup Wizard
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Starts the community onboarding wizard for server administrators.
 * Creates a new wizard session and guides them through setup.
 *
 * @module discord/commands/onboard
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { Redis } from 'ioredis';
import { logger } from '../../utils/logger.js';
import {
  WizardEngine,
  WizardSessionStore,
  stepHandlers,
  WizardSession,
  WizardComponent,
  WizardEmbed,
  StepHandlerResult,
  StepInput,
  WizardState,
} from '../../packages/wizard/index.js';

// Singleton instances (initialized lazily)
let sessionStore: WizardSessionStore | null = null;
let wizardEngine: WizardEngine | null = null;

/**
 * Initialize wizard components.
 *
 * @param redis - Redis client instance
 */
export function initializeWizard(redis: Redis): void {
  sessionStore = new WizardSessionStore({
    redis,
    keyPrefix: 'wizard',
    ttl: 15 * 60, // 15 minutes
    debug: process.env.NODE_ENV !== 'production',
  });

  wizardEngine = new WizardEngine({
    store: sessionStore,
    handlers: stepHandlers,
    debug: process.env.NODE_ENV !== 'production',
    onEvent: (event) => {
      logger.info({ event: event.type }, 'Wizard engine event');
    },
  });

  logger.info('Wizard engine initialized');
}

/**
 * Get wizard engine instance.
 */
function getEngine(): WizardEngine {
  if (!wizardEngine) {
    throw new Error('Wizard engine not initialized. Call initializeWizard() first.');
  }
  return wizardEngine;
}

/**
 * /onboard command definition
 */
export const onboardCommand = new SlashCommandBuilder()
  .setName('onboard')
  .setDescription('Start the community setup wizard (Admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

/**
 * Handle /onboard command execution.
 */
export async function handleOnboardCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const engine = getEngine();

  // CRITICAL: Defer reply within 3 seconds
  await interaction.deferReply({ ephemeral: true });

  try {
    // Check for existing active session
    const existingSession = await engine.resumeActive(
      interaction.guildId!,
      interaction.user.id
    );

    if (existingSession && existingSession.state !== WizardState.COMPLETE && existingSession.state !== WizardState.FAILED) {
      // Offer to resume or restart
      await interaction.editReply({
        content:
          'You have an active wizard session. Would you like to resume or start over?',
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`wizard:resume-existing:${existingSession.id}`)
              .setLabel('Resume')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`wizard:restart:${existingSession.id}`)
              .setLabel('Start Over')
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });
      return;
    }

    // Create new wizard session
    const session = await engine.start({
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      interactionId: interaction.id,
    });

    // Process initial state (INIT)
    const result = await engine.process(session.id);

    // Send initial wizard UI
    await sendWizardResponse(interaction, session, result);

    logger.info(
      {
        sessionId: session.id,
        userId: interaction.user.id,
        guildId: interaction.guildId,
      },
      'Started wizard session'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Failed to start wizard');

    await interaction.editReply({
      content: `Failed to start wizard: ${errorMessage}`,
    });
  }
}

/**
 * Handle wizard button interactions.
 */
export async function handleWizardButton(
  interaction: MessageComponentInteraction
): Promise<void> {
  const engine = getEngine();
  const customId = interaction.customId;

  // Parse customId: wizard:{action}:{sessionId}
  const parts = customId.split(':');
  if (parts.length < 3 || parts[0] !== 'wizard') {
    return;
  }

  const action = parts[1];
  const sessionId = parts[2];

  // Defer update to avoid timeout
  await interaction.deferUpdate();

  try {
    const session = await engine.getSession(sessionId);
    if (!session) {
      await interaction.editReply({
        content: 'Session expired. Please start a new wizard with /onboard.',
        components: [],
      });
      return;
    }

    // Verify user owns session
    if (session.userId !== interaction.user.id) {
      await interaction.followUp({
        content: 'This wizard session belongs to another user.',
        ephemeral: true,
      });
      return;
    }

    let result: StepHandlerResult;

    switch (action) {
      case 'back':
        result = await engine.back(sessionId);
        break;

      case 'cancel':
        await engine.cancel(sessionId);
        await interaction.editReply({
          content: 'Wizard cancelled. Use /onboard to start again.',
          embeds: [],
          components: [],
        });
        return;

      case 'resume-existing':
        result = await engine.process(sessionId);
        break;

      case 'restart':
        await engine.cancel(sessionId);
        // Create new session
        const newSession = await engine.start({
          guildId: interaction.guildId!,
          userId: interaction.user.id,
          channelId: interaction.channelId!,
        });
        result = await engine.process(newSession.id);
        await sendWizardResponse(interaction, newSession, result);
        return;

      default:
        // Generic button action - pass to handler
        result = await engine.process(sessionId, {
          type: 'button',
          customId: action,
        });
    }

    // Get updated session
    const updatedSession = await engine.getSession(sessionId);
    if (updatedSession) {
      await sendWizardResponse(interaction, updatedSession, result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, sessionId }, 'Wizard button error');

    await interaction.editReply({
      content: `Error: ${errorMessage}`,
      components: [],
    });
  }
}

/**
 * Handle wizard select menu interactions.
 */
export async function handleWizardSelect(
  interaction: MessageComponentInteraction
): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;

  const engine = getEngine();
  const customId = interaction.customId;

  // Parse customId: wizard:{type}:{sessionId}
  const parts = customId.split(':');
  if (parts.length < 3 || parts[0] !== 'wizard') {
    return;
  }

  const selectType = parts[1];
  const sessionId = parts[2];

  // Defer update
  await interaction.deferUpdate();

  try {
    const session = await engine.getSession(sessionId);
    if (!session) {
      await interaction.editReply({
        content: 'Session expired. Please start a new wizard with /onboard.',
        components: [],
      });
      return;
    }

    // Verify user owns session
    if (session.userId !== interaction.user.id) {
      await interaction.followUp({
        content: 'This wizard session belongs to another user.',
        ephemeral: true,
      });
      return;
    }

    // Process selection
    const input: StepInput = {
      type: 'select',
      customId: selectType,
      values: interaction.values,
    };

    const result = await engine.process(sessionId, input);

    // Get updated session
    const updatedSession = await engine.getSession(sessionId);
    if (updatedSession) {
      await sendWizardResponse(interaction, updatedSession, result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, sessionId }, 'Wizard select error');

    await interaction.editReply({
      content: `Error: ${errorMessage}`,
    });
  }
}

/**
 * Handle wizard modal submissions.
 */
export async function handleWizardModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const engine = getEngine();
  const customId = interaction.customId;

  // Parse customId: wizard:{type}:{sessionId}:{extra}
  const parts = customId.split(':');
  if (parts.length < 3 || parts[0] !== 'wizard') {
    return;
  }

  const modalType = parts[1];
  const sessionId = parts[2];

  // Defer update
  await interaction.deferUpdate();

  try {
    const session = await engine.getSession(sessionId);
    if (!session) {
      await interaction.editReply({
        content: 'Session expired. Please start a new wizard with /onboard.',
        components: [],
      });
      return;
    }

    // Extract fields from modal
    const fields: Record<string, string> = {};
    interaction.fields.fields.forEach((field, key) => {
      fields[key] = field.value;
    });

    // Process modal submission
    const input: StepInput = {
      type: 'modal',
      customId: modalType + (parts[3] ? `:${parts[3]}` : ''),
      fields,
    };

    const result = await engine.process(sessionId, input);

    // Get updated session
    const updatedSession = await engine.getSession(sessionId);
    if (updatedSession) {
      await sendWizardResponse(interaction, updatedSession, result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, sessionId }, 'Wizard modal error');

    await interaction.editReply({
      content: `Error: ${errorMessage}`,
    });
  }
}

/**
 * Send wizard response with embed and components.
 */
async function sendWizardResponse(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction,
  session: WizardSession,
  result: StepHandlerResult
): Promise<void> {
  const engine = getEngine();

  // Build embed
  const embedBuilder = new EmbedBuilder();

  if (result.embed) {
    embedBuilder.setTitle(result.embed.title);
    embedBuilder.setDescription(result.embed.description);

    if (result.embed.color) {
      embedBuilder.setColor(result.embed.color);
    }

    if (result.embed.fields) {
      for (const field of result.embed.fields) {
        embedBuilder.addFields({
          name: field.name,
          value: field.value,
          inline: field.inline ?? false,
        });
      }
    }

    if (result.embed.footer) {
      embedBuilder.setFooter({ text: result.embed.footer });
    }
  } else if (result.message) {
    embedBuilder.setDescription(result.message);
  }

  // Add progress bar
  const progressBar = engine.generateProgressBar(session);
  embedBuilder.setAuthor({ name: progressBar });

  // Build components
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (result.components) {
    for (const component of result.components) {
      if (component.type === 'button') {
        const button = new ButtonBuilder()
          .setCustomId(component.customId)
          .setLabel(component.label)
          .setStyle(
            component.style === 'primary'
              ? ButtonStyle.Primary
              : component.style === 'secondary'
                ? ButtonStyle.Secondary
                : component.style === 'success'
                  ? ButtonStyle.Success
                  : ButtonStyle.Danger
          );

        if (component.disabled) {
          button.setDisabled(true);
        }

        // Find or create button row
        let buttonRow = rows.find(
          (r) => r.components[0] instanceof ButtonBuilder && r.components.length < 5
        ) as ActionRowBuilder<ButtonBuilder> | undefined;

        if (!buttonRow) {
          buttonRow = new ActionRowBuilder<ButtonBuilder>();
          rows.push(buttonRow);
        }

        buttonRow.addComponents(button);
      } else if (component.type === 'select') {
        const select = new StringSelectMenuBuilder()
          .setCustomId(component.customId)
          .setPlaceholder(component.placeholder)
          .addOptions(
            component.options.map((opt) => ({
              label: opt.label,
              value: opt.value,
              description: opt.description,
              default: opt.default,
            }))
          );

        if (component.minValues) {
          select.setMinValues(component.minValues);
        }
        if (component.maxValues) {
          select.setMaxValues(component.maxValues);
        }

        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
      }
    }
  }

  // Add navigation components
  const navComponents = engine.buildNavigationComponents(session);
  if (navComponents.length > 0) {
    let navRow = rows.find(
      (r) => r.components[0] instanceof ButtonBuilder && r.components.length < 5
    ) as ActionRowBuilder<ButtonBuilder> | undefined;

    if (!navRow) {
      navRow = new ActionRowBuilder<ButtonBuilder>();
      rows.push(navRow);
    }

    for (const nav of navComponents) {
      if (nav.type === 'button') {
        const navButton = new ButtonBuilder()
          .setCustomId(nav.customId)
          .setLabel(nav.label)
          .setStyle(nav.style === 'danger' ? ButtonStyle.Danger : ButtonStyle.Secondary);

        if (nav.disabled) {
          navButton.setDisabled(true);
        }

        navRow.addComponents(navButton);
      }
    }
  }

  // Send response
  await interaction.editReply({
    embeds: [embedBuilder],
    components: rows.slice(0, 5), // Discord allows max 5 rows
  });
}

/**
 * Check if a custom ID belongs to the wizard.
 */
export function isWizardInteraction(customId: string): boolean {
  return customId.startsWith('wizard:');
}

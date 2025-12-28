/**
 * /resume Command - Resume Wizard Session
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Allows users to resume an existing wizard session by ID.
 * Sessions persist in Redis and survive container restarts.
 *
 * @module discord/commands/resume
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
} from 'discord.js';
import { Redis } from 'ioredis';
import { logger } from '../../utils/logger.js';
import {
  WizardEngine,
  WizardSessionStore,
  stepHandlers,
  WizardSession,
  StepHandlerResult,
  WizardState,
  isSessionExpired,
  STATE_DISPLAY_NAMES,
} from '../../packages/wizard/index.js';

// Reference the same instances from onboard.ts
// In a real implementation, these would be from a shared service
let sessionStore: WizardSessionStore | null = null;
let wizardEngine: WizardEngine | null = null;

/**
 * Initialize resume command with existing wizard components.
 * This should be called after initializeWizard() from onboard.ts.
 *
 * @param store - Session store instance
 * @param engine - Wizard engine instance
 */
export function initializeResumeCommand(
  store: WizardSessionStore,
  engine: WizardEngine
): void {
  sessionStore = store;
  wizardEngine = engine;
}

/**
 * Get session store instance.
 */
function getStore(): WizardSessionStore {
  if (!sessionStore) {
    throw new Error('Session store not initialized. Call initializeResumeCommand() first.');
  }
  return sessionStore;
}

/**
 * Get wizard engine instance.
 */
function getEngine(): WizardEngine {
  if (!wizardEngine) {
    throw new Error('Wizard engine not initialized. Call initializeResumeCommand() first.');
  }
  return wizardEngine;
}

/**
 * /resume command definition
 */
export const resumeCommand = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume an existing wizard session')
  .addStringOption((option) =>
    option
      .setName('session_id')
      .setDescription('Session ID to resume (optional - finds your active session if not provided)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

/**
 * Handle /resume command execution.
 */
export async function handleResumeCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const engine = getEngine();
  const store = getStore();

  // CRITICAL: Defer reply within 3 seconds
  await interaction.deferReply({ ephemeral: true });

  try {
    const sessionId = interaction.options.getString('session_id');
    let session: WizardSession | null = null;

    if (sessionId) {
      // Resume specific session
      session = await engine.resume(sessionId);

      if (!session) {
        await interaction.editReply({
          content: `Session \`${sessionId}\` not found or has expired.\n\nUse \`/onboard\` to start a new wizard.`,
        });
        return;
      }

      // Verify user owns session or is in same guild
      if (session.guildId !== interaction.guildId) {
        await interaction.editReply({
          content: 'This session belongs to a different server.',
        });
        return;
      }

      if (session.userId !== interaction.user.id) {
        await interaction.editReply({
          content: 'This session belongs to another user. You can only resume your own sessions.',
        });
        return;
      }
    } else {
      // Find user's active session in this guild
      session = await engine.resumeActive(interaction.guildId!, interaction.user.id);

      if (!session) {
        await interaction.editReply({
          content:
            'No active wizard session found.\n\n' +
            'Use `/onboard` to start a new community setup wizard.',
        });
        return;
      }
    }

    // Check if session has expired
    if (isSessionExpired(session)) {
      await interaction.editReply({
        content:
          `Your wizard session has expired (sessions last 15 minutes).\n\n` +
          `Session ID: \`${session.id}\`\n` +
          `Last state: ${STATE_DISPLAY_NAMES[session.state]}\n\n` +
          `Use \`/onboard\` to start a new wizard.`,
      });
      return;
    }

    // Check if session is in terminal state
    if (session.state === WizardState.COMPLETE) {
      await interaction.editReply({
        content:
          'This wizard session has already completed successfully.\n\n' +
          'Use `/onboard` to start a new setup.',
      });
      return;
    }

    if (session.state === WizardState.FAILED) {
      await interaction.editReply({
        content:
          `This wizard session failed with error: ${session.error ?? 'Unknown error'}\n\n` +
          'Use `/onboard` to start a new setup.',
      });
      return;
    }

    // Process current state to generate UI
    const result = await engine.process(session.id);

    // Send wizard UI
    await sendResumedWizardResponse(interaction, session, result);

    logger.info(
      {
        sessionId: session.id,
        userId: interaction.user.id,
        state: session.state,
      },
      'Resumed wizard session'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Failed to resume wizard');

    await interaction.editReply({
      content: `Failed to resume wizard: ${errorMessage}`,
    });
  }
}

/**
 * Send resumed wizard response with embed and components.
 */
async function sendResumedWizardResponse(
  interaction: ChatInputCommandInteraction,
  session: WizardSession,
  result: StepHandlerResult
): Promise<void> {
  const engine = getEngine();

  // Build embed
  const embedBuilder = new EmbedBuilder();

  // Add "Resumed" notification
  embedBuilder.setAuthor({ name: '🔄 Session Resumed' });

  if (result.embed) {
    embedBuilder.setTitle(result.embed.title);
    embedBuilder.setDescription(
      `*Continuing from where you left off...*\n\n${result.embed.description}`
    );

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

    // Add session info
    embedBuilder.addFields({
      name: '📋 Session Info',
      value:
        `ID: \`${session.id}\`\n` +
        `Started: <t:${Math.floor(new Date(session.createdAt).getTime() / 1000)}:R>\n` +
        `Steps completed: ${session.stepCount}`,
      inline: false,
    });

    if (result.embed.footer) {
      embedBuilder.setFooter({ text: result.embed.footer });
    }
  } else if (result.message) {
    embedBuilder.setDescription(result.message);
  }

  // Add progress bar
  const progressBar = engine.generateProgressBar(session);
  embedBuilder.setDescription(
    `**Progress:** ${progressBar}\n\n` + (embedBuilder.data.description ?? '')
  );

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
    components: rows.slice(0, 5),
  });
}

// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * /arrakis takeover Slash Command
 *
 * Admin command for executing role takeover (Sprint 63).
 * Transitions from primary to exclusive mode with three-step confirmation.
 *
 * Usage:
 * - /arrakis takeover - Start takeover process with three-step confirmation
 *
 * Three-step confirmation:
 * 1. Type community name to confirm identity
 * 2. Type "I understand" to acknowledge risks
 * 3. Type "confirmed" to acknowledge rollback plan
 *
 * CRITICAL: This is a one-way operation. Once in exclusive mode,
 * the community cannot rollback to previous modes.
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
  type GuildMember,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  createMigrationEngine,
  type TakeoverConfirmationState,
} from '../../packages/adapters/coexistence/index.js';
import type { ICoexistenceStorage } from '../../packages/core/ports/ICoexistenceStorage.js';

// In-memory store for confirmation states (keyed by `${guildId}-${userId}`)
const confirmationStates = new Map<string, TakeoverConfirmationState>();

// Callback type for renaming Discord roles
type RenameRolesCallback = (
  guildId: string,
  roleRenames: Array<{ roleId: string; newName: string }>
) => Promise<void>;

/**
 * Slash command definition
 */
export const adminTakeoverCommand = new SlashCommandBuilder()
  .setName('arrakis-takeover')
  .setDescription('Admin: Execute role takeover (transition to exclusive mode)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Storage and rename callback will be injected at runtime
let coexistenceStorage: ICoexistenceStorage | null = null;
let renameRolesCallback: RenameRolesCallback | null = null;

/**
 * Set the coexistence storage adapter (called during bot initialization)
 */
export function setTakeoverStorage(storage: ICoexistenceStorage): void {
  coexistenceStorage = storage;
}

/**
 * Set the role rename callback (called during bot initialization)
 */
export function setRenameRolesCallback(callback: RenameRolesCallback): void {
  renameRolesCallback = callback;
}

/**
 * Handle /arrakis-takeover command execution
 */
export async function handleAdminTakeoverCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const adminDiscordId = interaction.user.id;
  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name ?? 'Unknown';

  logger.info({ adminDiscordId, guildId }, 'Admin takeover command invoked');

  // Ensure storage is configured
  if (!coexistenceStorage) {
    await interaction.reply({
      content: '❌ Coexistence storage not configured. Contact administrator.',
      ephemeral: true,
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ This command must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Get community ID from guild
  const communityId = guildId;

  const engine = createMigrationEngine(coexistenceStorage);

  // Check if takeover is available
  const canTakeoverResult = await engine.canTakeover(communityId);

  if (!canTakeoverResult.canTakeover) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Takeover Not Available')
      .setColor(0xe74c3c)
      .setDescription(canTakeoverResult.reason ?? 'Cannot proceed with takeover')
      .addFields(
        { name: 'Current Mode', value: canTakeoverResult.currentMode, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Create confirmation state
  const confirmation = engine.createTakeoverConfirmation(communityId, adminDiscordId);
  const confirmationKey = `${guildId}-${adminDiscordId}`;
  confirmationStates.set(confirmationKey, confirmation);

  // Show step 1 modal: Community name confirmation
  const step1Modal = new ModalBuilder()
    .setCustomId(`takeover_step1_${guildId}`)
    .setTitle('Takeover Confirmation - Step 1/3')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('community_name')
          .setLabel(`Type your server name to confirm: "${guildName}"`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(guildName)
          .setRequired(true)
      )
    );

  await interaction.showModal(step1Modal);
}

/**
 * Handle modal submissions for takeover steps
 */
export async function handleTakeoverModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const customId = interaction.customId;
  const guildId = interaction.guildId;
  const adminId = interaction.user.id;

  if (!guildId || !coexistenceStorage) {
    await interaction.reply({
      content: '❌ Error processing confirmation.',
      ephemeral: true,
    });
    return;
  }

  const confirmationKey = `${guildId}-${adminId}`;
  const confirmation = confirmationStates.get(confirmationKey);

  if (!confirmation) {
    await interaction.reply({
      content: '❌ Confirmation session not found or expired. Please start again with /arrakis-takeover.',
      ephemeral: true,
    });
    return;
  }

  // Check if expired
  if (new Date() > confirmation.expiresAt) {
    confirmationStates.delete(confirmationKey);
    await interaction.reply({
      content: '❌ Confirmation expired. Please start again with /arrakis-takeover.',
      ephemeral: true,
    });
    return;
  }

  const engine = createMigrationEngine(
    coexistenceStorage,
    undefined,
    undefined,
    renameRolesCallback ?? undefined
  );

  // Handle Step 1: Community name
  if (customId.startsWith('takeover_step1_')) {
    const inputName = interaction.fields.getTextInputValue('community_name');
    const expectedName = interaction.guild?.name ?? '';

    const result = engine.validateTakeoverStep(confirmation, 'community_name', inputName, expectedName);

    if (!result.valid) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    // Update state
    confirmationStates.set(confirmationKey, result.updatedConfirmation);

    // Show step 2 modal: Acknowledge risks
    const step2Modal = new ModalBuilder()
      .setCustomId(`takeover_step2_${guildId}`)
      .setTitle('Takeover Confirmation - Step 2/3')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('acknowledge_risks')
            .setLabel('Type "I understand" to acknowledge the risks')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('I understand')
            .setRequired(true)
        )
      );

    await interaction.showModal(step2Modal);
    return;
  }

  // Handle Step 2: Acknowledge risks
  if (customId.startsWith('takeover_step2_')) {
    const inputAck = interaction.fields.getTextInputValue('acknowledge_risks');

    const result = engine.validateTakeoverStep(confirmation, 'acknowledge_risks', inputAck);

    if (!result.valid) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    // Update state
    confirmationStates.set(confirmationKey, result.updatedConfirmation);

    // Show step 3 modal: Rollback plan acknowledgment
    const step3Modal = new ModalBuilder()
      .setCustomId(`takeover_step3_${guildId}`)
      .setTitle('Takeover Confirmation - Step 3/3')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('rollback_plan')
            .setLabel('Type "confirmed" to proceed (NO ROLLBACK POSSIBLE)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('confirmed')
            .setRequired(true)
        )
      );

    await interaction.showModal(step3Modal);
    return;
  }

  // Handle Step 3: Rollback plan acknowledgment - Execute takeover
  if (customId.startsWith('takeover_step3_')) {
    const inputConfirm = interaction.fields.getTextInputValue('rollback_plan');

    const result = engine.validateTakeoverStep(confirmation, 'rollback_plan', inputConfirm);

    if (!result.valid) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    // Update state and verify completion
    const finalConfirmation = result.updatedConfirmation;
    confirmationStates.set(confirmationKey, finalConfirmation);

    if (!engine.isTakeoverConfirmationComplete(finalConfirmation)) {
      await interaction.reply({
        content: '❌ Confirmation incomplete. Please start again.',
        ephemeral: true,
      });
      confirmationStates.delete(confirmationKey);
      return;
    }

    // Defer reply for takeover execution
    await interaction.deferReply({ ephemeral: true });

    try {
      // Execute takeover
      const takeoverResult = await engine.executeTakeover(
        confirmation.communityId,
        guildId,
        finalConfirmation
      );

      // Clean up confirmation state
      confirmationStates.delete(confirmationKey);

      if (takeoverResult.success) {
        const successEmbed = new EmbedBuilder()
          .setTitle('👑 Takeover Complete')
          .setColor(0x27ae60)
          .setDescription(
            '**Arrakis is now the exclusive token-gating solution for this server.**\n\n' +
            'The incumbent bot has been disabled and roles have been renamed.'
          )
          .addFields(
            { name: 'Previous Mode', value: takeoverResult.previousMode, inline: true },
            { name: 'New Mode', value: takeoverResult.newMode, inline: true },
            { name: 'Roles Renamed', value: takeoverResult.rolesRenamed.toString(), inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

        logger.info(
          { guildId, adminId, rolesRenamed: takeoverResult.rolesRenamed },
          'Takeover completed successfully'
        );
      } else {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Takeover Failed')
          .setColor(0xe74c3c)
          .setDescription(takeoverResult.error ?? 'Unknown error occurred')
          .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });

        logger.error({ guildId, adminId, error: takeoverResult.error }, 'Takeover failed');
      }
    } catch (error) {
      logger.error({ error, guildId, adminId }, 'Takeover execution error');
      await interaction.editReply({
        content: '❌ An error occurred during takeover. Please try again or contact support.',
      });
    }
  }
}

/**
 * Clean up expired confirmation states
 *
 * Call this periodically (e.g., every minute) to remove stale states.
 */
export function cleanupExpiredConfirmations(): void {
  const now = new Date();
  for (const [key, state] of confirmationStates.entries()) {
    if (now > state.expiresAt) {
      confirmationStates.delete(key);
    }
  }
}

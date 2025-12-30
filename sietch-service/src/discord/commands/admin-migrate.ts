/**
 * /arrakis migrate Slash Command
 *
 * Admin command for migration strategy selection and execution (Sprint 62).
 *
 * Usage:
 * - /arrakis migrate check - Check migration readiness
 * - /arrakis migrate plan <strategy> - Preview migration plan (dry run)
 * - /arrakis migrate execute <strategy> - Execute migration
 *
 * Strategies:
 * - instant: Immediately transition to parallel mode
 * - gradual: Migrate new members immediately, existing over N days
 * - parallel_forever: Enable parallel mode indefinitely
 * - arrakis_primary: Make Arrakis the primary gate
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  ComponentType,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  createMigrationEngine,
  MIN_SHADOW_DAYS,
  MIN_ACCURACY_PERCENT,
  type ReadinessCheckResult,
  type MigrationPlan,
} from '../../packages/adapters/coexistence/index.js';
import type { ICoexistenceStorage } from '../../packages/core/ports/ICoexistenceStorage.js';
import type { MigrationStrategy } from '../../packages/adapters/storage/schema.js';

// Strategy descriptions for user display
const STRATEGY_DESCRIPTIONS: Record<MigrationStrategy, string> = {
  instant: 'Immediately transition to parallel mode. All members get Arrakis roles instantly.',
  gradual: 'Migrate new members immediately, existing members over N days in batches.',
  parallel_forever: 'Enable parallel mode indefinitely. Both systems run side-by-side forever.',
  arrakis_primary: 'Make Arrakis the primary gate. Incumbent remains as backup.',
};

const STRATEGY_EMOJIS: Record<MigrationStrategy, string> = {
  instant: '⚡',
  gradual: '📈',
  parallel_forever: '🔄',
  arrakis_primary: '👑',
};

/**
 * Slash command definition
 */
export const adminMigrateCommand = new SlashCommandBuilder()
  .setName('arrakis')
  .setDescription('Admin: Arrakis migration and coexistence management')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup((group) =>
    group
      .setName('migrate')
      .setDescription('Migration strategy selection and execution')
      .addSubcommand((sub) =>
        sub.setName('check').setDescription('Check migration readiness')
      )
      .addSubcommand((sub) =>
        sub
          .setName('plan')
          .setDescription('Preview migration plan (dry run)')
          .addStringOption((opt) =>
            opt
              .setName('strategy')
              .setDescription('Migration strategy to plan')
              .setRequired(true)
              .addChoices(
                { name: '⚡ Instant - Immediate parallel mode', value: 'instant' },
                { name: '📈 Gradual - Batch migration over days', value: 'gradual' },
                { name: '🔄 Parallel Forever - Both systems indefinitely', value: 'parallel_forever' },
                { name: '👑 Arrakis Primary - Arrakis as main gate', value: 'arrakis_primary' }
              )
          )
          .addIntegerOption((opt) =>
            opt
              .setName('batch_size')
              .setDescription('For gradual: members per batch (default: 100)')
              .setMinValue(10)
              .setMaxValue(1000)
          )
          .addIntegerOption((opt) =>
            opt
              .setName('duration_days')
              .setDescription('For gradual: migration duration in days (default: 7)')
              .setMinValue(1)
              .setMaxValue(30)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('execute')
          .setDescription('Execute migration with confirmation')
          .addStringOption((opt) =>
            opt
              .setName('strategy')
              .setDescription('Migration strategy to execute')
              .setRequired(true)
              .addChoices(
                { name: '⚡ Instant - Immediate parallel mode', value: 'instant' },
                { name: '📈 Gradual - Batch migration over days', value: 'gradual' },
                { name: '🔄 Parallel Forever - Both systems indefinitely', value: 'parallel_forever' },
                { name: '👑 Arrakis Primary - Arrakis as main gate', value: 'arrakis_primary' }
              )
          )
          .addIntegerOption((opt) =>
            opt
              .setName('batch_size')
              .setDescription('For gradual: members per batch (default: 100)')
              .setMinValue(10)
              .setMaxValue(1000)
          )
          .addIntegerOption((opt) =>
            opt
              .setName('duration_days')
              .setDescription('For gradual: migration duration in days (default: 7)')
              .setMinValue(1)
              .setMaxValue(30)
          )
      )
  );

// Storage will be injected at runtime
let coexistenceStorage: ICoexistenceStorage | null = null;

/**
 * Set the coexistence storage adapter (called during bot initialization)
 */
export function setCoexistenceStorage(storage: ICoexistenceStorage): void {
  coexistenceStorage = storage;
}

/**
 * Handle /arrakis migrate command execution
 */
export async function handleAdminMigrateCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const adminDiscordId = interaction.user.id;
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  logger.info(
    { adminDiscordId, subcommandGroup, subcommand },
    'Admin migrate command invoked'
  );

  // Ensure storage is configured
  if (!coexistenceStorage) {
    await interaction.reply({
      content: '❌ Coexistence storage not configured. Contact administrator.',
      ephemeral: true,
    });
    return;
  }

  // Defer reply for all subcommands
  await interaction.deferReply({ ephemeral: true });

  try {
    // Get community ID from guild
    // In a real implementation, this would lookup the community from the guild
    const communityId = interaction.guildId ?? 'unknown';

    const engine = createMigrationEngine(coexistenceStorage);

    switch (subcommand) {
      case 'check':
        await handleCheckReadiness(interaction, engine, communityId);
        break;

      case 'plan':
        await handlePlanMigration(interaction, engine, communityId);
        break;

      case 'execute':
        await handleExecuteMigration(interaction, engine, communityId);
        break;

      default:
        await interaction.editReply({
          content: `❌ Unknown subcommand: ${subcommand}`,
        });
    }
  } catch (error) {
    logger.error({ error, adminDiscordId }, 'Admin migrate command failed');
    await interaction.editReply({
      content: '❌ Migration command failed. Check logs for details.',
    });
  }
}

/**
 * Handle /arrakis migrate check
 */
async function handleCheckReadiness(
  interaction: ChatInputCommandInteraction,
  engine: ReturnType<typeof createMigrationEngine>,
  communityId: string
): Promise<void> {
  const readiness = await engine.checkReadiness(communityId);
  const embed = buildReadinessEmbed(readiness);

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle /arrakis migrate plan (dry run)
 */
async function handlePlanMigration(
  interaction: ChatInputCommandInteraction,
  engine: ReturnType<typeof createMigrationEngine>,
  communityId: string
): Promise<void> {
  const strategy = interaction.options.getString('strategy', true) as MigrationStrategy;
  const batchSize = interaction.options.getInteger('batch_size') ?? undefined;
  const durationDays = interaction.options.getInteger('duration_days') ?? undefined;

  const result = await engine.executeMigration(communityId, {
    strategy,
    batchSize,
    durationDays,
    dryRun: true,
  });

  if (!result.success && result.error) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Migration Plan Failed')
      .setColor(0xe74c3c)
      .setDescription(result.error)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (result.plan) {
    const embed = buildPlanEmbed(result.plan, strategy);
    await interaction.editReply({ embeds: [embed] });
  }
}

/**
 * Handle /arrakis migrate execute
 */
async function handleExecuteMigration(
  interaction: ChatInputCommandInteraction,
  engine: ReturnType<typeof createMigrationEngine>,
  communityId: string
): Promise<void> {
  const strategy = interaction.options.getString('strategy', true) as MigrationStrategy;
  const batchSize = interaction.options.getInteger('batch_size') ?? undefined;
  const durationDays = interaction.options.getInteger('duration_days') ?? undefined;

  // First check readiness
  const readiness = await engine.checkReadiness(communityId);

  if (!readiness.ready) {
    const embed = buildReadinessEmbed(readiness);
    embed.setTitle('⛔ Migration Blocked - Not Ready');
    embed.setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Show confirmation dialog
  const confirmEmbed = new EmbedBuilder()
    .setTitle(`${STRATEGY_EMOJIS[strategy]} Confirm Migration: ${strategy}`)
    .setColor(0xf39c12)
    .setDescription(
      `**⚠️ This action will modify your community's token-gating configuration.**\n\n` +
        `**Strategy:** ${strategy}\n` +
        `**Description:** ${STRATEGY_DESCRIPTIONS[strategy]}\n\n` +
        `Are you sure you want to proceed?`
    )
    .setTimestamp();

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('migrate_confirm')
      .setLabel('Confirm Migration')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('migrate_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌')
  );

  const response = await interaction.editReply({
    embeds: [confirmEmbed],
    components: [confirmRow],
  });

  // Wait for button interaction
  try {
    const buttonInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 60_000, // 60 second timeout
      filter: (i) => i.user.id === interaction.user.id,
    });

    if (buttonInteraction.customId === 'migrate_cancel') {
      await buttonInteraction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle('Migration Cancelled')
            .setColor(0x95a5a6)
            .setDescription('Migration was cancelled by user.')
            .setTimestamp(),
        ],
        components: [],
      });
      return;
    }

    // Execute migration
    await buttonInteraction.deferUpdate();

    const result = await engine.executeMigration(communityId, {
      strategy,
      batchSize,
      durationDays,
    });

    if (result.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle(`${STRATEGY_EMOJIS[strategy]} Migration Executed Successfully`)
        .setColor(0x27ae60)
        .addFields(
          { name: 'Strategy', value: strategy, inline: true },
          { name: 'New Mode', value: result.newMode, inline: true },
          { name: 'Executed At', value: result.executedAt.toISOString(), inline: false }
        )
        .setTimestamp();

      if (strategy === 'gradual' && result.initialBatchSize !== undefined) {
        successEmbed.addFields(
          { name: 'Initial Batch', value: result.initialBatchSize.toString(), inline: true },
          {
            name: 'Remaining Batches',
            value: (result.remainingBatches ?? 0).toString(),
            inline: true,
          }
        );
      }

      await buttonInteraction.editReply({
        embeds: [successEmbed],
        components: [],
      });
    } else {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Migration Failed')
        .setColor(0xe74c3c)
        .setDescription(result.error ?? 'Unknown error occurred')
        .setTimestamp();

      await buttonInteraction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
    }
  } catch {
    // Timeout or error
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Migration Timed Out')
          .setColor(0x95a5a6)
          .setDescription('Confirmation timed out. Please try again.')
          .setTimestamp(),
      ],
      components: [],
    });
  }
}

/**
 * Build readiness check embed
 */
function buildReadinessEmbed(readiness: ReadinessCheckResult): EmbedBuilder {
  const statusEmoji = readiness.ready ? '✅' : '❌';
  const statusColor = readiness.ready ? 0x27ae60 : 0xe74c3c;

  const embed = new EmbedBuilder()
    .setTitle(`${statusEmoji} Migration Readiness Check`)
    .setColor(statusColor)
    .addFields(
      {
        name: 'Shadow Days',
        value: `${readiness.shadowDays} / ${readiness.requiredShadowDays} ${readiness.checks.shadowDaysCheck ? '✅' : '❌'}`,
        inline: true,
      },
      {
        name: 'Accuracy',
        value: `${readiness.accuracyPercent.toFixed(1)}% / ${readiness.requiredAccuracyPercent}% ${readiness.checks.accuracyCheck ? '✅' : '❌'}`,
        inline: true,
      },
      {
        name: 'Incumbent Configured',
        value: readiness.checks.incumbentConfigured ? '✅ Yes' : '❌ No',
        inline: true,
      },
      {
        name: 'Mode Valid',
        value: readiness.checks.modeCheck ? '✅ Yes' : '❌ No',
        inline: true,
      }
    )
    .setTimestamp();

  if (!readiness.ready && readiness.reason) {
    embed.addFields({
      name: 'Blocking Reasons',
      value: readiness.reason,
      inline: false,
    });
  }

  if (readiness.ready) {
    embed.setDescription('✅ Community is ready for migration!');
  } else {
    embed.setDescription(
      `⏳ Not ready yet. Requirements:\n` +
        `• Shadow mode for at least **${MIN_SHADOW_DAYS} days**\n` +
        `• Accuracy at least **${MIN_ACCURACY_PERCENT}%**\n` +
        `• Incumbent bot configured\n` +
        `• Currently in shadow or parallel mode`
    );
  }

  return embed;
}

/**
 * Build migration plan embed
 */
function buildPlanEmbed(plan: MigrationPlan, strategy: MigrationStrategy): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${STRATEGY_EMOJIS[strategy]} Migration Plan: ${strategy}`)
    .setColor(0x3498db)
    .setDescription(STRATEGY_DESCRIPTIONS[strategy])
    .addFields(
      { name: 'Source Mode', value: plan.sourceMode, inline: true },
      { name: 'Target Mode', value: plan.targetMode, inline: true },
      { name: 'Readiness', value: plan.readiness.ready ? '✅ Ready' : '❌ Not Ready', inline: true }
    )
    .setTimestamp();

  if (strategy === 'gradual') {
    embed.addFields(
      { name: 'Total Members', value: (plan.totalMembers ?? 0).toString(), inline: true },
      { name: 'Batch Size', value: (plan.batchSize ?? 100).toString(), inline: true },
      { name: 'Duration', value: `${plan.durationDays ?? 7} days`, inline: true }
    );

    if (plan.estimatedCompletion) {
      const dateStr = plan.estimatedCompletion.toISOString().split('T')[0] ?? '';
      embed.addFields({
        name: 'Estimated Completion',
        value: dateStr,
        inline: false,
      });
    }
  }

  embed.setFooter({ text: 'Dry run - no changes made' });

  return embed;
}

/**
 * Handle button interactions for migration commands
 */
export async function handleAdminMigrateButton(
  interaction: ButtonInteraction
): Promise<void> {
  // Button interactions are handled inline with awaitMessageComponent
  // This export is for the command router if needed
  logger.debug({ customId: interaction.customId }, 'Migration button interaction');
}

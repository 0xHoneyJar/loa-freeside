/**
 * /register-waitlist Slash Command
 *
 * Allows users in positions 70-100 to register for eligibility alerts.
 * Assigns the @Taqwa role for Cave Entrance channel access.
 *
 * Ephemeral response - private to user.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { thresholdService } from '../../services/threshold.js';
import { assignTaqwaRole, isTaqwaRoleConfigured } from '../../services/roleManager.js';
import {
  buildWaitlistRegistrationEmbed,
  buildWaitlistErrorEmbed,
  buildWaitlistStatusEmbed,
  buildWaitlistUnregisterEmbed,
} from '../embeds/threshold.js';

/**
 * Validate wallet address format
 */
function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Slash command definition
 */
export const registerWaitlistCommand = new SlashCommandBuilder()
  .setName('register-waitlist')
  .setDescription('Register for eligibility alerts when you can join the Sietch')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('register')
      .setDescription('Register your wallet for eligibility alerts')
      .addStringOption((option) =>
        option
          .setName('wallet')
          .setDescription('Your wallet address (0x...)')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Check your waitlist registration status')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unregister')
      .setDescription('Remove your waitlist registration')
  );

/**
 * Handle /register-waitlist command execution
 */
export async function handleRegisterWaitlistCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'register':
        await handleRegister(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      case 'unregister':
        await handleUnregister(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ error, discordUserId, subcommand }, 'Error handling /register-waitlist command');

    const errorMessage = 'An error occurred. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle /register-waitlist register <wallet>
 */
async function handleRegister(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const wallet = interaction.options.getString('wallet', true).toLowerCase();

  // Validate wallet format
  if (!isValidWalletAddress(wallet)) {
    const embed = buildWaitlistErrorEmbed(
      'Invalid wallet address format. Please provide a valid Ethereum address (0x followed by 40 hex characters).'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Attempt registration
  const result = await thresholdService.registerWaitlist(discordUserId, wallet);

  if (!result.success) {
    const embed = buildWaitlistErrorEmbed(result.error || 'Registration failed.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Assign Taqwa role if configured
  if (isTaqwaRoleConfigured()) {
    const roleAssigned = await assignTaqwaRole(discordUserId);
    if (!roleAssigned) {
      logger.warn(
        { discordUserId },
        'Failed to assign Taqwa role during waitlist registration'
      );
    }
  }

  // Build success embed
  const embed = buildWaitlistRegistrationEmbed(result.position!);
  await interaction.reply({ embeds: [embed], ephemeral: true });

  logger.info(
    {
      discordUserId,
      wallet,
      position: result.position?.position,
    },
    'User registered for waitlist'
  );
}

/**
 * Handle /register-waitlist status
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  // Get registration
  const registration = thresholdService.getRegistration(discordUserId);

  if (!registration) {
    const embed = buildWaitlistErrorEmbed(
      'You are not registered for the waitlist. Use `/register-waitlist register <wallet>` to sign up.'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Get current position (may have changed since registration)
  const currentPosition = thresholdService.getWalletPosition(registration.walletAddress);

  const embed = buildWaitlistStatusEmbed(
    currentPosition,
    registration.registeredAt
  );
  await interaction.reply({ embeds: [embed], ephemeral: true });

  logger.debug({ discordUserId }, 'Served /register-waitlist status');
}

/**
 * Handle /register-waitlist unregister
 */
async function handleUnregister(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  // Check if registered
  const registration = thresholdService.getRegistration(discordUserId);

  if (!registration) {
    const embed = buildWaitlistErrorEmbed(
      'You are not registered for the waitlist.'
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Unregister
  const success = thresholdService.unregisterWaitlist(discordUserId);

  if (!success) {
    const embed = buildWaitlistErrorEmbed('Failed to unregister. Please try again.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Note: We don't remove the Taqwa role here - users keep access to Cave Entrance
  // This is a deliberate design choice to maintain community access

  const embed = buildWaitlistUnregisterEmbed();
  await interaction.reply({ embeds: [embed], ephemeral: true });

  logger.info({ discordUserId }, 'User unregistered from waitlist');
}

/**
 * /position Slash Command
 *
 * Displays the user's current position in the eligibility ranking.
 * Shows distance to adjacent positions and entry threshold.
 *
 * Ephemeral visibility - only the user can see their position.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  getMemberProfileByDiscordId,
  getWalletByDiscordId,
  getWalletPosition,
  getCurrentEligibility,
} from '../../db/index.js';
import { naibService } from '../../services/naib.js';
import { thresholdService } from '../../services/threshold.js';
import { notificationService } from '../../services/notification.js';
import { buildPositionStatusEmbed } from '../embeds/alerts.js';

/**
 * At-risk threshold: bottom 10% of eligible members (positions 63-69)
 */
const AT_RISK_THRESHOLD_POSITION = 63;
const ENTRY_THRESHOLD_POSITION = 69;

/**
 * Slash command definition
 */
export const positionCommand = new SlashCommandBuilder()
  .setName('position')
  .setDescription('View your current position in the Sietch eligibility ranking');

/**
 * Handle /position command execution
 */
export async function handlePositionCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
    // Get member profile
    const member = getMemberProfileByDiscordId(discordUserId);

    if (!member) {
      await interaction.reply({
        content: '❌ You are not a member of the Sietch. Use `/onboard` to begin the onboarding process.',
        ephemeral: true,
      });
      return;
    }

    // Get wallet address from mapping
    const walletAddress = getWalletByDiscordId(discordUserId);
    if (!walletAddress) {
      await interaction.reply({
        content: '❌ Your profile does not have a wallet address linked. Please complete your profile.',
        ephemeral: true,
      });
      return;
    }

    // Get wallet position
    const walletPosition = getWalletPosition(walletAddress);

    if (!walletPosition) {
      await interaction.reply({
        content: '❌ Could not find your wallet in the eligibility rankings. Your BGT holdings may be too low to rank.',
        ephemeral: true,
      });
      return;
    }

    // Calculate distances
    const eligibility = getCurrentEligibility();
    const position = walletPosition.position;
    const bgt = Number(BigInt(walletPosition.bgt)) / 1e18;

    // Find adjacent wallets for distance calculation
    let distanceToAbove: number | null = null;
    let distanceToBelow: number | null = null;

    const currentIndex = eligibility.findIndex((e) => e.rank === position);
    if (currentIndex > 0) {
      const above = eligibility[currentIndex - 1];
      if (above) {
        const aboveBgt = Number(BigInt(above.bgtHeld)) / 1e18;
        distanceToAbove = aboveBgt - bgt;
      }
    }
    if (currentIndex < eligibility.length - 1 && currentIndex >= 0) {
      const below = eligibility[currentIndex + 1];
      if (below) {
        const belowBgt = Number(BigInt(below.bgtHeld)) / 1e18;
        distanceToBelow = bgt - belowBgt;
      }
    }

    // Distance to entry (position 69)
    let distanceToEntry: number | null = null;
    const entryThreshold = thresholdService.getEntryThreshold();
    if (position > ENTRY_THRESHOLD_POSITION && entryThreshold) {
      distanceToEntry = entryThreshold.human - bgt;
    }

    // Check Naib status
    const isNaib = naibService.isCurrentNaib(member.memberId);
    const isFedaykin = position <= ENTRY_THRESHOLD_POSITION;
    const isAtRisk = notificationService.isAtRisk(position);

    // Build embed
    const embed = buildPositionStatusEmbed({
      position,
      bgt,
      distanceToAbove,
      distanceToBelow,
      distanceToEntry,
      isNaib,
      isFedaykin,
      isAtRisk,
    });

    // Send as ephemeral (private)
    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });

    logger.debug(
      { discordUserId, memberId: member.memberId, position },
      'Served /position command'
    );
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling /position command');

    const errorMessage = 'An error occurred while loading your position. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

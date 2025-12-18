import {
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  onboardingService,
  ONBOARDING_BUTTONS,
  ONBOARDING_MODALS,
} from '../../services/onboarding.js';
import { profileService } from '../../services/profile.js';
import { logger } from '../../utils/logger.js';

/**
 * Check if an interaction is an onboarding button
 */
export function isOnboardingButton(customId: string): boolean {
  return Object.values(ONBOARDING_BUTTONS).includes(customId as typeof ONBOARDING_BUTTONS[keyof typeof ONBOARDING_BUTTONS]);
}

/**
 * Check if an interaction is an onboarding modal
 */
export function isOnboardingModal(customId: string): boolean {
  return Object.values(ONBOARDING_MODALS).includes(customId as typeof ONBOARDING_MODALS[keyof typeof ONBOARDING_MODALS]);
}

/**
 * Handle onboarding button interactions
 */
export async function handleOnboardingButton(
  interaction: ButtonInteraction
): Promise<void> {
  const customId = interaction.customId;

  try {
    switch (customId) {
      case ONBOARDING_BUTTONS.START:
        await onboardingService.handleStartButton(interaction);
        break;

      case ONBOARDING_BUTTONS.PFP_UPLOAD:
      case ONBOARDING_BUTTONS.PFP_GENERATE:
      case ONBOARDING_BUTTONS.PFP_SKIP:
        await onboardingService.handlePfpButton(interaction);
        break;

      case ONBOARDING_BUTTONS.BIO_ADD:
      case ONBOARDING_BUTTONS.BIO_SKIP:
        await onboardingService.handleBioButton(interaction);
        break;

      case ONBOARDING_BUTTONS.EDIT_NYM:
      case ONBOARDING_BUTTONS.EDIT_PFP:
      case ONBOARDING_BUTTONS.EDIT_BIO:
      case ONBOARDING_BUTTONS.EDIT_CANCEL:
        await onboardingService.handleEditButton(interaction);
        break;

      default:
        logger.warn({ customId }, 'Unknown onboarding button');
        await interaction.reply({
          content: 'Unknown action',
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ error, customId, userId: interaction.user.id }, 'Error handling onboarding button');

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred. Please try again.',
        ephemeral: true,
      });
    }
  }
}

/**
 * Handle onboarding modal submissions
 */
export async function handleOnboardingModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const customId = interaction.customId;

  try {
    // Check if this is an edit (user has existing profile)
    const profile = profileService.getProfileByDiscordId(interaction.user.id);
    const session = onboardingService.getSession(interaction.user.id);

    switch (customId) {
      case ONBOARDING_MODALS.NYM_INPUT:
        if (profile && session?.currentStep === -1) {
          // Edit mode
          await onboardingService.handleEditNymSubmit(interaction, profile);
        } else {
          // Onboarding mode
          await onboardingService.handleNymSubmit(interaction);
        }
        break;

      case ONBOARDING_MODALS.BIO_INPUT:
        if (profile && session?.currentStep === -1) {
          // Edit mode
          await onboardingService.handleEditBioSubmit(interaction, profile);
        } else {
          // Onboarding mode
          await onboardingService.handleBioSubmit(interaction);
        }
        break;

      case ONBOARDING_MODALS.PFP_URL_INPUT:
        await onboardingService.handlePfpUrlSubmit(interaction);
        break;

      default:
        logger.warn({ customId }, 'Unknown onboarding modal');
        await interaction.reply({
          content: 'Unknown form',
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ error, customId, userId: interaction.user.id }, 'Error handling onboarding modal');

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred. Please try again.',
        ephemeral: true,
      });
    }
  }
}

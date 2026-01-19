/**
 * Init Handler - Welcome step
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * First step of the wizard that welcomes the user and explains the process.
 *
 * @module packages/wizard/handlers/initHandler
 */

import type { WizardSession } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import type { StepHandler, StepHandlerResult, StepInput } from '../WizardEngine.js';

/**
 * Init step handler.
 *
 * Displays welcome message and overview of the setup process.
 * Always transitions to CHAIN_SELECT on "Start" button click.
 */
export const initHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  // If user clicked "Start", advance to chain selection
  if (input?.type === 'button' && input.customId?.includes('start')) {
    return {
      success: true,
      nextState: WizardState.CHAIN_SELECT,
      message: 'Starting community setup...',
    };
  }

  // Generate welcome UI
  return {
    success: true,
    embed: {
      title: '🏛️ Community Onboarding Wizard',
      description:
        "Welcome! This wizard will guide you through setting up your token-gated Discord community.\n\n" +
        "Here's what we'll configure:\n\n" +
        "**1. Blockchain Selection** - Choose your network\n" +
        "**2. Asset Configuration** - Define tokens/NFTs for eligibility\n" +
        "**3. Eligibility Rules** - Set tier thresholds\n" +
        "**4. Role Mapping** - Connect tiers to Discord roles\n" +
        "**5. Channel Structure** - Set up private channels\n" +
        "**6. Review & Deploy** - Confirm and apply\n\n" +
        "You can go back to any step or cancel at any time.\n" +
        "Your progress is saved automatically.",
      color: 0x5865f2, // Discord blurple
      fields: [
        {
          name: '⏱️ Estimated Time',
          value: '5-10 minutes',
          inline: true,
        },
        {
          name: '📋 Session ID',
          value: `\`${session.id}\``,
          inline: true,
        },
      ],
      footer: 'Use /resume to continue this setup later',
    },
    components: [
      {
        type: 'button',
        customId: `wizard:start:${session.id}`,
        label: 'Start Setup →',
        style: 'primary',
      },
    ],
  };
};

/**
 * Eligibility Rules Handler - Tier Configuration
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Allows user to define tier thresholds based on rank.
 *
 * @module packages/wizard/handlers/eligibilityRulesHandler
 */

import { WizardSession, TierConfig } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import { StepHandler, StepHandlerResult, StepInput } from '../WizardEngine.js';

/**
 * Default tier templates.
 */
const DEFAULT_TIER_TEMPLATES: Record<string, TierConfig[]> = {
  simple: [
    { name: 'Gold', minRank: 1, maxRank: 10, color: '#FFD700' },
    { name: 'Silver', minRank: 11, maxRank: 50, color: '#C0C0C0' },
    { name: 'Bronze', minRank: 51, maxRank: 100, color: '#CD7F32' },
  ],
  standard: [
    { name: 'Diamond', minRank: 1, maxRank: 5, color: '#B9F2FF' },
    { name: 'Platinum', minRank: 6, maxRank: 20, color: '#E5E4E2' },
    { name: 'Gold', minRank: 21, maxRank: 50, color: '#FFD700' },
    { name: 'Silver', minRank: 51, maxRank: 100, color: '#C0C0C0' },
    { name: 'Bronze', minRank: 101, maxRank: 500, color: '#CD7F32' },
  ],
  sietch: [
    { name: 'Naib', minRank: 1, maxRank: 7, color: '#FFD700' },
    { name: 'Fedaykin', minRank: 8, maxRank: 69, color: '#DAA520' },
    { name: 'Usul', minRank: 70, maxRank: 100, color: '#87CEEB' },
    { name: 'Sayyadina', minRank: 101, maxRank: 150, color: '#DDA0DD' },
    { name: 'Mushtamal', minRank: 151, maxRank: 200, color: '#90EE90' },
    { name: 'Sihaya', minRank: 201, maxRank: 300, color: '#20B2AA' },
    { name: 'Qanat', minRank: 301, maxRank: 500, color: '#4169E1' },
    { name: 'Ichwan', minRank: 501, maxRank: 1000, color: '#8B4513' },
    { name: 'Hajra', minRank: 1001, maxRank: 999999, color: '#808080' },
  ],
};

/**
 * Eligibility rules step handler.
 *
 * Allows user to select a tier template or customize tiers.
 */
export const eligibilityRulesHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  const currentTiers = session.data.tiers ?? [];

  // Handle template selection
  if (input?.type === 'select' && input.customId?.includes('tier-template') && input.values?.length) {
    const templateId = input.values[0];
    const template = DEFAULT_TIER_TEMPLATES[templateId];

    if (!template) {
      return {
        success: false,
        error: `Unknown template: ${templateId}`,
      };
    }

    return {
      success: true,
      data: { tiers: template },
      message: `Applied ${templateId} tier template with ${template.length} tiers.`,
    };
  }

  // Handle "Continue" button
  if (input?.type === 'button' && input.customId?.includes('continue')) {
    if (currentTiers.length === 0) {
      return {
        success: false,
        error: 'Please select a tier template before continuing.',
      };
    }

    return {
      success: true,
      nextState: WizardState.ROLE_MAPPING,
      message: 'Tier configuration complete. Now let\'s map tiers to Discord roles.',
    };
  }

  // Handle "Customize" button - opens modal for tier editing
  if (input?.type === 'button' && input.customId?.includes('customize')) {
    return {
      success: true,
      embed: {
        title: '⚙️ Customize Tiers',
        description:
          'Tier customization is available in the full version.\n\n' +
          'For now, please select a template that best fits your community.',
        color: 0xFFA500,
      },
      components: [
        {
          type: 'button',
          customId: `wizard:back-to-templates:${session.id}`,
          label: '← Back to Templates',
          style: 'secondary',
        },
      ],
    };
  }

  // Generate tier configuration UI
  const tierList = currentTiers.length > 0
    ? currentTiers
        .map((t) => `• **${t.name}**: Rank ${t.minRank}-${t.maxRank}`)
        .join('\n')
    : '_No tiers configured yet. Select a template below._';

  return {
    success: true,
    embed: {
      title: '📊 Step 3: Eligibility Rules',
      description:
        'Define the tier structure for your community.\n\n' +
        'Tiers are based on member ranking (by token holdings, activity, etc.).\n\n' +
        '**Current Tiers:**\n' +
        tierList,
      color: 0x5865f2,
      fields: [
        {
          name: '💡 Tip',
          value:
            'Start with a template and customize later. ' +
            'The Simple template works well for most communities.',
          inline: false,
        },
      ],
      footer: 'Step 3 of 8',
    },
    components: [
      {
        type: 'select',
        customId: `wizard:tier-template:${session.id}`,
        placeholder: 'Select a tier template...',
        options: [
          {
            label: '🥉 Simple (3 tiers)',
            value: 'simple',
            description: 'Gold, Silver, Bronze - good for small communities',
            default: currentTiers.length === 3,
          },
          {
            label: '🏆 Standard (5 tiers)',
            value: 'standard',
            description: 'Diamond to Bronze - balanced progression',
            default: currentTiers.length === 5,
          },
          {
            label: '🏜️ Sietch (9 tiers)',
            value: 'sietch',
            description: 'Dune-themed - Naib to Hajra',
            default: currentTiers.length === 9,
          },
        ],
      },
      {
        type: 'button',
        customId: `wizard:continue:${session.id}`,
        label: 'Continue →',
        style: currentTiers.length > 0 ? 'primary' : 'secondary',
        disabled: currentTiers.length === 0,
      },
    ],
  };
};

/**
 * Review Handler - Configuration Summary
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Shows a summary of all configuration before deployment.
 *
 * @module packages/wizard/handlers/reviewHandler
 */

import type { WizardSession } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import type { StepHandler, StepHandlerResult, StepInput, WizardEmbed } from '../WizardEngine.js';

/**
 * Review step handler.
 *
 * Displays complete configuration summary and confirms deployment.
 */
export const reviewHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  const { chainId, assets, tiers, roleMappings, channels } = session.data;

  // Handle "Deploy" button
  if (input?.type === 'button' && input.customId?.includes('deploy')) {
    return {
      success: true,
      nextState: WizardState.DEPLOY,
      message: 'Starting deployment...',
    };
  }

  // Handle "Edit" buttons - go back to specific step
  if (input?.type === 'button' && input.customId?.includes('edit-')) {
    const targetStep = input.customId.split('edit-')[1]?.split(':')[0];

    const stepMapping: Record<string, WizardState> = {
      chain: WizardState.CHAIN_SELECT,
      assets: WizardState.ASSET_CONFIG,
      tiers: WizardState.ELIGIBILITY_RULES,
      roles: WizardState.ROLE_MAPPING,
      channels: WizardState.CHANNEL_STRUCTURE,
    };

    const targetState = stepMapping[targetStep ?? ''];
    if (targetState) {
      return {
        success: true,
        nextState: targetState,
        message: `Editing ${targetStep}...`,
      };
    }
  }

  // Generate summary embed
  const embed: WizardEmbed = {
    title: '📋 Step 6: Review Configuration',
    description:
      'Please review your community setup before deployment.\n\n' +
      'Click **Deploy** to create your token-gated community, or go back to edit any section.',
    color: 0x5865f2,
    fields: [
      {
        name: '⛓️ Blockchain',
        value: chainId ?? '_Not selected_',
        inline: true,
      },
      {
        name: '🪙 Assets',
        value: assets?.length
          ? assets.map((a) => `${a.symbol} (${a.type})`).join(', ')
          : '_None_',
        inline: true,
      },
      {
        name: '📊 Tiers',
        value: tiers?.length
          ? `${tiers.length} tiers: ${tiers.map((t) => t.name).join(', ')}`
          : '_None_',
        inline: false,
      },
      {
        name: '🎭 Roles',
        value: roleMappings?.length
          ? roleMappings.map((r) => `${r.tierName}: ${r.createNew ? '🆕 Create' : '✅ Existing'}`).join('\n')
          : '_None_',
        inline: true,
      },
      {
        name: '📁 Channels',
        value: channels?.length
          ? `${channels.filter((c) => c.type !== 'category').length} channels in ${channels.filter((c) => c.type === 'category').length} categories`
          : '_Manual setup_',
        inline: true,
      },
    ],
    footer: 'Step 6 of 8 • Ready for deployment',
  };

  // Validation warnings
  const warnings: string[] = [];
  if (!chainId) warnings.push('⚠️ No blockchain selected');
  if (!assets?.length) warnings.push('⚠️ No assets configured');
  if (!tiers?.length) warnings.push('⚠️ No tiers configured');
  if (!roleMappings?.length) warnings.push('⚠️ No role mappings configured');

  if (warnings.length > 0) {
    embed.fields?.push({
      name: '⚠️ Warnings',
      value: warnings.join('\n'),
      inline: false,
    });
  }

  const canDeploy = chainId && assets?.length && tiers?.length && roleMappings?.length;

  return {
    success: true,
    embed,
    components: [
      {
        type: 'button',
        customId: `wizard:deploy:${session.id}`,
        label: '🚀 Deploy',
        style: 'success',
        disabled: !canDeploy,
      },
      {
        type: 'button',
        customId: `wizard:edit-chain:${session.id}`,
        label: 'Edit Chain',
        style: 'secondary',
      },
      {
        type: 'button',
        customId: `wizard:edit-tiers:${session.id}`,
        label: 'Edit Tiers',
        style: 'secondary',
      },
    ],
  };
};

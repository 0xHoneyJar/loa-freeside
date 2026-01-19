/**
 * Role Mapping Handler - Discord Role Configuration
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Maps tiers to Discord roles (create new or use existing).
 *
 * @module packages/wizard/handlers/roleMappingHandler
 */

import type { WizardSession, RoleMapping } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import type { StepHandler, StepHandlerResult, StepInput } from '../WizardEngine.js';

/**
 * Role mapping step handler.
 *
 * For each tier, allows user to create a new role or select an existing one.
 */
export const roleMappingHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  const tiers = session.data.tiers ?? [];
  const currentMappings = session.data.roleMappings ?? [];

  // No tiers configured - should not happen
  if (tiers.length === 0) {
    return {
      success: false,
      error: 'No tiers configured. Please go back and set up eligibility rules.',
    };
  }

  // Handle "Auto-create roles" button
  if (input?.type === 'button' && input.customId?.includes('auto-create')) {
    const autoMappings: RoleMapping[] = tiers.map((tier) => ({
      tierName: tier.name,
      roleId: '', // Will be created during deployment
      createNew: true,
      roleName: tier.name,
      roleColor: tier.color,
    }));

    return {
      success: true,
      data: { roleMappings: autoMappings },
      message: 'Configured auto-creation for all tier roles.',
    };
  }

  // Handle role selection for a specific tier
  if (input?.type === 'select' && input.customId?.includes('role-') && input.values?.length) {
    const tierName = input.customId.split('role-')[1]?.split(':')[0];
    const selectedRoleId = input.values[0];

    if (!tierName) {
      return { success: false, error: 'Invalid tier selection' };
    }

    // Find existing mapping or create new one
    const existingIndex = currentMappings.findIndex((m) => m.tierName === tierName);
    const newMapping: RoleMapping = {
      tierName,
      roleId: selectedRoleId === 'create_new' ? '' : (selectedRoleId ?? ''),
      createNew: selectedRoleId === 'create_new',
      roleName: selectedRoleId === 'create_new' ? tierName : undefined,
      roleColor: tiers.find((t) => t.name === tierName)?.color,
    };

    const updatedMappings = [...currentMappings];
    if (existingIndex >= 0) {
      updatedMappings[existingIndex] = newMapping;
    } else {
      updatedMappings.push(newMapping);
    }

    return {
      success: true,
      data: { roleMappings: updatedMappings },
      message: `Configured role for ${tierName}.`,
    };
  }

  // Handle "Continue" button
  if (input?.type === 'button' && input.customId?.includes('continue')) {
    // Check all tiers have mappings
    const unmappedTiers = tiers.filter(
      (tier) => !currentMappings.find((m) => m.tierName === tier.name)
    );

    if (unmappedTiers.length > 0) {
      return {
        success: false,
        error: `Please configure roles for: ${unmappedTiers.map((t) => t.name).join(', ')}`,
      };
    }

    return {
      success: true,
      nextState: WizardState.CHANNEL_STRUCTURE,
      message: 'Role mapping complete. Now let\'s set up your channel structure.',
    };
  }

  // Generate role mapping UI
  const mappingStatus = tiers.map((tier) => {
    const mapping = currentMappings.find((m) => m.tierName === tier.name);
    if (!mapping) {
      return `• **${tier.name}**: ⚠️ Not configured`;
    }
    if (mapping.createNew) {
      return `• **${tier.name}**: 🆕 Create new role "${mapping.roleName}"`;
    }
    return `• **${tier.name}**: ✅ Using role <@&${mapping.roleId}>`;
  });

  const allMapped = currentMappings.length >= tiers.length;

  return {
    success: true,
    embed: {
      title: '🎭 Step 4: Role Mapping',
      description:
        'Map each tier to a Discord role.\n\n' +
        'You can create new roles or use existing ones.\n\n' +
        '**Role Mappings:**\n' +
        mappingStatus.join('\n'),
      color: 0x5865f2,
      fields: [
        {
          name: '📊 Progress',
          value: `${currentMappings.length}/${tiers.length} tiers mapped`,
          inline: true,
        },
        {
          name: '💡 Tip',
          value:
            'Click "Auto-Create All" to automatically create roles for all tiers ' +
            'with matching names and colors.',
          inline: false,
        },
      ],
      footer: 'Step 4 of 8',
    },
    components: [
      {
        type: 'button',
        customId: `wizard:auto-create:${session.id}`,
        label: '✨ Auto-Create All',
        style: 'secondary',
      },
      {
        type: 'button',
        customId: `wizard:continue:${session.id}`,
        label: 'Continue →',
        style: allMapped ? 'primary' : 'secondary',
        disabled: !allMapped,
      },
    ],
  };
};

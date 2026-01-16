/**
 * ROLE_MAPPING Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Fifth step: Role mapping configuration.
 * Users map membership tiers to Discord roles.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type { WizardSession, TierRoleMapping } from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import {
  BaseStepHandler,
  createButton,
  createSelectMenu,
  createActionRow,
  createNavigationButtons,
  ButtonStyle,
} from './base.js';

// =============================================================================
// Default Tier Configuration
// =============================================================================

const DEFAULT_TIERS = [
  {
    tierId: 'fedaykin',
    name: 'Fedaykin',
    color: 0xcd7f32, // Bronze
    emoji: '⚔️',
    description: 'Entry-level members',
  },
  {
    tierId: 'sietch',
    name: 'Sietch',
    color: 0xc0c0c0, // Silver
    emoji: '🏠',
    description: 'Established members',
  },
  {
    tierId: 'naib',
    name: 'Naib',
    color: 0xffd700, // Gold
    emoji: '👑',
    description: 'Top-tier members',
  },
];

// =============================================================================
// Color Presets
// =============================================================================

const COLOR_PRESETS = [
  { name: 'Bronze', value: 0xcd7f32 },
  { name: 'Silver', value: 0xc0c0c0 },
  { name: 'Gold', value: 0xffd700 },
  { name: 'Blue', value: 0x5865f2 },
  { name: 'Green', value: 0x57f287 },
  { name: 'Red', value: 0xed4245 },
  { name: 'Purple', value: 0x9b59b6 },
  { name: 'Orange', value: 0xe67e22 },
];

// =============================================================================
// ROLE_MAPPING Step Handler
// =============================================================================

export class RoleMappingStepHandler extends BaseStepHandler {
  readonly step = WizardState.ROLE_MAPPING;

  constructor(logger: Logger) {
    super(logger.child({ step: 'ROLE_MAPPING' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const tierRoles = data.tierRoles as TierRoleMapping[] | undefined;

    if (!tierRoles || tierRoles.length === 0) {
      return this.errorResult('Please configure at least one tier role mapping');
    }

    // Validate mappings
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    this.log.info(
      { sessionId: context.sessionId, tierCount: tierRoles.length },
      'ROLE_MAPPING step completed'
    );

    return this.successResult(
      undefined,
      `Configured ${tierRoles.length} role mapping(s)`
    );
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const rules = session.data.rules ?? [];
    const tierRoles = session.data.tierRoles ?? [];

    const embed = this.createStepEmbed(
      'Role Mapping',
      `Map membership tiers to Discord roles.

**Configured Rules:** ${rules.length}

Each tier will create a corresponding Discord role that members will receive when they qualify.`,
      session
    );

    // Show existing mappings
    if (tierRoles.length > 0) {
      (embed as { fields?: unknown[] }).fields = [
        {
          name: `Role Mappings (${tierRoles.length})`,
          value: tierRoles
            .map((mapping) => {
              const colorHex = mapping.roleColor.toString(16).padStart(6, '0');
              return `**${mapping.roleName}** (Tier: ${mapping.tierId})\n   Color: #${colorHex} | Hoisted: ${mapping.hoist ? 'Yes' : 'No'}`;
            })
            .join('\n\n'),
          inline: false,
        },
      ];
    }

    // Tier select
    const tierSelect = createSelectMenu(
      'wizard:role_mapping:tier',
      'Select tier...',
      DEFAULT_TIERS.map((tier) => ({
        label: tier.name,
        value: tier.tierId,
        description: tier.description,
        emoji: tier.emoji,
      }))
    );

    // Color select
    const colorSelect = createSelectMenu(
      'wizard:role_mapping:color',
      'Select role color...',
      COLOR_PRESETS.map((color) => ({
        label: color.name,
        value: color.value.toString(),
        description: `#${color.value.toString(16).padStart(6, '0')}`,
      }))
    );

    const components = [
      createActionRow([tierSelect]),
      createActionRow([colorSelect]),
      createActionRow([
        createButton('wizard:role_mapping:add', 'Add Mapping', ButtonStyle.Primary, false, '➕'),
        createButton('wizard:role_mapping:defaults', 'Use Defaults', ButtonStyle.Secondary, false, '⚡'),
        createButton('wizard:role_mapping:remove', 'Remove Last', ButtonStyle.Secondary, tierRoles.length === 0, '🗑️'),
      ]),
      createNavigationButtons('role_mapping', true, tierRoles.length === 0),
    ];

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    _session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const tierRoles = input.data.tierRoles as TierRoleMapping[] | undefined;

    if (!tierRoles || tierRoles.length === 0) {
      errors.push('At least one tier role mapping is required');
      return { valid: false, errors };
    }

    const usedTierIds = new Set<string>();
    const usedRoleNames = new Set<string>();

    for (let i = 0; i < tierRoles.length; i++) {
      const mapping = tierRoles[i]!;
      const prefix = `Mapping ${i + 1}`;

      // Validate tier ID
      if (!mapping.tierId?.trim()) {
        errors.push(`${prefix}: Tier ID is required`);
      } else if (usedTierIds.has(mapping.tierId)) {
        errors.push(`${prefix}: Tier "${mapping.tierId}" is already mapped`);
      } else {
        usedTierIds.add(mapping.tierId);
      }

      // Validate role name
      if (!mapping.roleName?.trim()) {
        errors.push(`${prefix}: Role name is required`);
      } else if (mapping.roleName.length > 100) {
        errors.push(`${prefix}: Role name must be 100 characters or less`);
      } else if (usedRoleNames.has(mapping.roleName.toLowerCase())) {
        errors.push(`${prefix}: Role name "${mapping.roleName}" is already used`);
      } else {
        usedRoleNames.add(mapping.roleName.toLowerCase());
      }

      // Validate color (must be valid hex color number)
      if (typeof mapping.roleColor !== 'number' || mapping.roleColor < 0 || mapping.roleColor > 0xffffff) {
        errors.push(`${prefix}: Invalid role color`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generate default tier role mappings.
   */
  generateDefaultMappings(): TierRoleMapping[] {
    return DEFAULT_TIERS.map((tier) => ({
      tierId: tier.tierId,
      roleName: tier.name,
      roleColor: tier.color,
      mentionable: false,
      hoist: true, // Display separately
    }));
  }
}

/**
 * Create a ROLE_MAPPING step handler.
 */
export function createRoleMappingStepHandler(logger: Logger): RoleMappingStepHandler {
  return new RoleMappingStepHandler(logger);
}

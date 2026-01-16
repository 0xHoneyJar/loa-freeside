/**
 * CHANNEL_STRUCTURE Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Sixth step: Channel structure configuration.
 * Users select a channel template or customize channel structure.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type {
  WizardSession,
  ChannelTemplate,
  ChannelConfig,
} from '@arrakis/core/domain';
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
// Channel Template Options
// =============================================================================

const CHANNEL_TEMPLATES: Array<{
  template: ChannelTemplate;
  label: string;
  emoji: string;
  description: string;
  channelPreview: string;
}> = [
  {
    template: 'none',
    label: 'No Channels',
    emoji: '🚫',
    description: 'Only create roles, no channels',
    channelPreview: 'No channels will be created',
  },
  {
    template: 'additive_only',
    label: 'Additive Only',
    emoji: '➕',
    description: 'Add gated channels without modifying existing',
    channelPreview: '• #holders-only\n• #announcements\n• #general',
  },
  {
    template: 'parallel_mirror',
    label: 'Parallel Mirror',
    emoji: '🪞',
    description: 'Mirror existing channels with tier gates',
    channelPreview: '• Tier 1 Category\n• Tier 2 Category\n• Tier 3 Category',
  },
  {
    template: 'custom',
    label: 'Custom',
    emoji: '🔧',
    description: 'Fully customize channel structure',
    channelPreview: 'Configure channels manually',
  },
];

// =============================================================================
// CHANNEL_STRUCTURE Step Handler
// =============================================================================

export class ChannelStructureStepHandler extends BaseStepHandler {
  readonly step = WizardState.CHANNEL_STRUCTURE;

  constructor(logger: Logger) {
    super(logger.child({ step: 'CHANNEL_STRUCTURE' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const channelTemplate = data.channelTemplate as ChannelTemplate | undefined;
    const customChannels = data.customChannels as ChannelConfig[] | undefined;

    if (!channelTemplate) {
      return this.errorResult('Please select a channel template');
    }

    // Validate
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    this.log.info(
      { sessionId: context.sessionId, template: channelTemplate },
      'CHANNEL_STRUCTURE step completed'
    );

    const templateInfo = CHANNEL_TEMPLATES.find((t) => t.template === channelTemplate);

    return this.successResult(
      undefined,
      `Channel template set to: ${templateInfo?.label ?? channelTemplate}`
    );
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const tierRoles = session.data.tierRoles ?? [];
    const selectedTemplate = session.data.channelTemplate;
    const customChannels = session.data.customChannels ?? [];

    const embed = this.createStepEmbed(
      'Channel Structure',
      `Choose how to structure your Discord channels.

**Configured Tiers:** ${tierRoles.map((t) => t.roleName).join(', ') || 'None'}

Select a template below. Each template provides different channel organization based on your membership tiers.`,
      session
    );

    // Show selected template details
    if (selectedTemplate) {
      const templateInfo = CHANNEL_TEMPLATES.find((t) => t.template === selectedTemplate);
      const fields: unknown[] = [
        {
          name: 'Selected Template',
          value: `${templateInfo?.emoji ?? ''} **${templateInfo?.label ?? selectedTemplate}**\n${templateInfo?.description ?? ''}`,
          inline: false,
        },
        {
          name: 'Channel Preview',
          value: templateInfo?.channelPreview ?? 'No preview available',
          inline: false,
        },
      ];

      // Show custom channels if template is 'custom'
      if (selectedTemplate === 'custom' && customChannels.length > 0) {
        fields.push({
          name: `Custom Channels (${customChannels.length})`,
          value: customChannels
            .map((ch) => `${ch.type === 'category' ? '📁' : ch.type === 'voice' ? '🔊' : '💬'} ${ch.name}`)
            .join('\n'),
          inline: false,
        });
      }

      (embed as { fields?: unknown[] }).fields = fields;
    }

    // Template select
    const templateSelect = createSelectMenu(
      'wizard:channel_structure:template',
      'Select channel template...',
      CHANNEL_TEMPLATES.map((template) => ({
        label: template.label,
        value: template.template,
        description: template.description,
        emoji: template.emoji,
        default: selectedTemplate === template.template,
      }))
    );

    const components = [
      createActionRow([templateSelect]),
    ];

    // Add custom channel controls if template is 'custom'
    if (selectedTemplate === 'custom') {
      components.push(
        createActionRow([
          createButton('wizard:channel_structure:add_category', 'Add Category', ButtonStyle.Secondary, false, '📁'),
          createButton('wizard:channel_structure:add_text', 'Add Text Channel', ButtonStyle.Secondary, false, '💬'),
          createButton('wizard:channel_structure:add_voice', 'Add Voice Channel', ButtonStyle.Secondary, false, '🔊'),
          createButton('wizard:channel_structure:remove', 'Remove Last', ButtonStyle.Secondary, customChannels.length === 0, '🗑️'),
        ])
      );
    }

    components.push(
      createNavigationButtons('channel_structure', true, !selectedTemplate)
    );

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const channelTemplate = input.data.channelTemplate as ChannelTemplate | undefined;
    const customChannels = input.data.customChannels as ChannelConfig[] | undefined;

    // Validate template selection
    const validTemplates = new Set(CHANNEL_TEMPLATES.map((t) => t.template));
    if (!channelTemplate) {
      errors.push('Channel template must be selected');
    } else if (!validTemplates.has(channelTemplate)) {
      errors.push(`Invalid channel template: ${channelTemplate}`);
    }

    // Validate custom channels if template is 'custom'
    if (channelTemplate === 'custom') {
      if (!customChannels || customChannels.length === 0) {
        errors.push('Custom template requires at least one channel configuration');
      } else {
        const tierIds = new Set(session.data.tierRoles?.map((t) => t.tierId) ?? []);

        for (let i = 0; i < customChannels.length; i++) {
          const channel = customChannels[i]!;
          const prefix = `Channel ${i + 1}`;

          // Validate name
          if (!channel.name?.trim()) {
            errors.push(`${prefix}: Channel name is required`);
          } else if (channel.name.length > 100) {
            errors.push(`${prefix}: Channel name must be 100 characters or less`);
          } else if (!/^[\w-]+$/.test(channel.name)) {
            errors.push(`${prefix}: Channel name can only contain letters, numbers, underscores, and hyphens`);
          }

          // Validate type
          if (!['text', 'voice', 'category'].includes(channel.type)) {
            errors.push(`${prefix}: Invalid channel type "${channel.type}"`);
          }

          // Validate required tiers reference valid tiers
          for (const tierId of channel.requiredTiers ?? []) {
            if (!tierIds.has(tierId)) {
              errors.push(`${prefix}: Unknown tier "${tierId}"`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generate default channels for a template.
   */
  generateDefaultChannels(
    template: ChannelTemplate,
    tierRoles: WizardSession['data']['tierRoles']
  ): ChannelConfig[] {
    if (!tierRoles || tierRoles.length === 0) return [];

    switch (template) {
      case 'additive_only':
        return [
          {
            name: 'holders-announcements',
            type: 'text',
            topic: 'Announcements for token holders',
            requiredTiers: [tierRoles[0]!.tierId],
            permissionOverrides: [],
          },
          {
            name: 'holders-general',
            type: 'text',
            topic: 'General chat for token holders',
            requiredTiers: [tierRoles[0]!.tierId],
            permissionOverrides: [],
          },
          {
            name: 'holders-voice',
            type: 'voice',
            requiredTiers: [tierRoles[0]!.tierId],
            permissionOverrides: [],
          },
        ];

      case 'parallel_mirror':
        return tierRoles.flatMap((tier) => [
          {
            name: `${tier.roleName.toLowerCase()}-zone`,
            type: 'category' as const,
            requiredTiers: [tier.tierId],
            permissionOverrides: [],
          },
          {
            name: `${tier.roleName.toLowerCase()}-chat`,
            type: 'text' as const,
            topic: `Chat for ${tier.roleName} members`,
            requiredTiers: [tier.tierId],
            permissionOverrides: [],
          },
          {
            name: `${tier.roleName.toLowerCase()}-voice`,
            type: 'voice' as const,
            requiredTiers: [tier.tierId],
            permissionOverrides: [],
          },
        ]);

      default:
        return [];
    }
  }
}

/**
 * Create a CHANNEL_STRUCTURE step handler.
 */
export function createChannelStructureStepHandler(
  logger: Logger
): ChannelStructureStepHandler {
  return new ChannelStructureStepHandler(logger);
}

/**
 * Channel Structure Handler - Discord Channel Configuration
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Configures private channels for tier members.
 *
 * @module packages/wizard/handlers/channelStructureHandler
 */

import { WizardSession, ChannelConfig } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import { StepHandler, StepHandlerResult, StepInput } from '../WizardEngine.js';

/**
 * Default channel templates.
 */
const CHANNEL_TEMPLATES: Record<string, ChannelConfig[]> = {
  minimal: [
    { name: '📢 announcements', type: 'text', accessTiers: ['*'], topic: 'Important announcements for all members' },
    { name: '💬 general', type: 'text', accessTiers: ['*'], topic: 'General discussion' },
    { name: '🎙️ voice', type: 'voice', accessTiers: ['*'] },
  ],
  standard: [
    { name: 'COMMUNITY', type: 'category', accessTiers: ['*'] },
    { name: '📢 announcements', type: 'text', accessTiers: ['*'], parent: 'COMMUNITY', topic: 'Important updates' },
    { name: '💬 general', type: 'text', accessTiers: ['*'], parent: 'COMMUNITY', topic: 'General chat' },
    { name: '🎙️ voice-lounge', type: 'voice', accessTiers: ['*'], parent: 'COMMUNITY' },
    { name: 'VIP', type: 'category', accessTiers: ['tier-1', 'tier-2'] },
    { name: '👑 vip-chat', type: 'text', accessTiers: ['tier-1', 'tier-2'], parent: 'VIP', topic: 'Top tier members only' },
    { name: '🎤 vip-voice', type: 'voice', accessTiers: ['tier-1', 'tier-2'], parent: 'VIP' },
  ],
  sietch: [
    { name: 'SIETCH SCROLLS', type: 'category', accessTiers: ['*'] },
    { name: '📜 announcements', type: 'text', accessTiers: ['*'], parent: 'SIETCH SCROLLS', topic: 'Decrees from the Sietch' },
    { name: '📖 history', type: 'text', accessTiers: ['*'], parent: 'SIETCH SCROLLS', topic: 'Chronicles of the Sietch' },
    { name: 'NAIB COUNCIL', type: 'category', accessTiers: ['Naib'] },
    { name: '👑 council-chamber', type: 'text', accessTiers: ['Naib'], parent: 'NAIB COUNCIL', topic: 'For Naibs only' },
    { name: '🎤 naib-voice', type: 'voice', accessTiers: ['Naib'], parent: 'NAIB COUNCIL' },
    { name: 'THE STILLSUIT', type: 'category', accessTiers: ['*'] },
    { name: '💧 oasis', type: 'text', accessTiers: ['*'], parent: 'THE STILLSUIT', topic: 'Rest and recover' },
    { name: '🗣️ voice-sietch', type: 'voice', accessTiers: ['*'], parent: 'THE STILLSUIT' },
  ],
};

/**
 * Channel structure step handler.
 *
 * Allows user to select a channel template or customize channels.
 */
export const channelStructureHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  const currentChannels = session.data.channels ?? [];

  // Handle template selection
  if (input?.type === 'select' && input.customId?.includes('channel-template') && input.values?.length) {
    const templateId = input.values[0];
    const template = CHANNEL_TEMPLATES[templateId];

    if (!template) {
      return {
        success: false,
        error: `Unknown template: ${templateId}`,
      };
    }

    // Map template tiers to actual tier names
    const tiers = session.data.tiers ?? [];
    const mappedChannels = template.map((channel) => ({
      ...channel,
      accessTiers: channel.accessTiers.map((t) => {
        if (t === '*') return '*'; // All tiers
        if (t.startsWith('tier-')) {
          const tierIndex = parseInt(t.replace('tier-', ''), 10) - 1;
          return tiers[tierIndex]?.name ?? t;
        }
        return t;
      }),
    }));

    return {
      success: true,
      data: { channels: mappedChannels },
      message: `Applied ${templateId} channel template.`,
    };
  }

  // Handle "Continue" button
  if (input?.type === 'button' && input.customId?.includes('continue')) {
    if (currentChannels.length === 0) {
      return {
        success: false,
        error: 'Please select a channel template before continuing.',
      };
    }

    return {
      success: true,
      nextState: WizardState.REVIEW,
      message: 'Channel structure configured. Let\'s review everything.',
    };
  }

  // Handle "Skip" button
  if (input?.type === 'button' && input.customId?.includes('skip')) {
    return {
      success: true,
      nextState: WizardState.REVIEW,
      data: { channels: [] },
      message: 'Skipping channel creation. You can set up channels manually later.',
    };
  }

  // Generate channel structure UI
  const channelList = currentChannels.length > 0
    ? formatChannelList(currentChannels)
    : '_No channels configured yet. Select a template below._';

  return {
    success: true,
    embed: {
      title: '📁 Step 5: Channel Structure',
      description:
        'Configure the Discord channels for your community.\n\n' +
        'Templates include categories and channels with appropriate permissions.\n\n' +
        '**Channels:**\n' +
        channelList,
      color: 0x5865f2,
      fields: [
        {
          name: '💡 Tip',
          value:
            'You can skip this step and set up channels manually, ' +
            'or customize after initial deployment.',
          inline: false,
        },
      ],
      footer: 'Step 5 of 8',
    },
    components: [
      {
        type: 'select',
        customId: `wizard:channel-template:${session.id}`,
        placeholder: 'Select a channel template...',
        options: [
          {
            label: '📝 Minimal (3 channels)',
            value: 'minimal',
            description: 'Basic setup: announcements, general, voice',
          },
          {
            label: '🏠 Standard (7 channels)',
            value: 'standard',
            description: 'Includes VIP section for top tiers',
          },
          {
            label: '🏜️ Sietch (9 channels)',
            value: 'sietch',
            description: 'Dune-themed with Naib Council',
          },
        ],
      },
      {
        type: 'button',
        customId: `wizard:continue:${session.id}`,
        label: 'Continue →',
        style: currentChannels.length > 0 ? 'primary' : 'secondary',
        disabled: currentChannels.length === 0,
      },
      {
        type: 'button',
        customId: `wizard:skip:${session.id}`,
        label: 'Skip (Manual Setup)',
        style: 'secondary',
      },
    ],
  };
};

/**
 * Format channel list for display.
 */
function formatChannelList(channels: ChannelConfig[]): string {
  const lines: string[] = [];
  let currentCategory = '';

  for (const channel of channels) {
    if (channel.type === 'category') {
      currentCategory = channel.name;
      lines.push(`\n**${channel.name}**`);
    } else {
      const prefix = currentCategory ? '  ' : '';
      const typeIcon = channel.type === 'voice' ? '🔊' : channel.type === 'forum' ? '💬' : '#';
      const accessNote = channel.accessTiers.includes('*') ? '' : ` (${channel.accessTiers.join(', ')})`;
      lines.push(`${prefix}${typeIcon} ${channel.name}${accessNote}`);
    }
  }

  return lines.join('\n');
}

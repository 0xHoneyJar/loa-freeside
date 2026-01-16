/**
 * CHAIN_SELECT Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Second step: Blockchain selection.
 * Users select which chains they want to use for eligibility checking.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type { WizardSession, ChainConfig, ChainId } from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import {
  BaseStepHandler,
  createSelectMenu,
  createActionRow,
  createNavigationButtons,
} from './base.js';

// =============================================================================
// Supported Chains
// =============================================================================

const SUPPORTED_CHAINS: Array<{
  id: ChainId;
  name: string;
  emoji: string;
  description: string;
}> = [
  {
    id: 'berachain',
    name: 'Berachain',
    emoji: '🐻',
    description: 'Berachain (Bera)',
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    emoji: '💎',
    description: 'Ethereum Mainnet',
  },
  {
    id: 'polygon',
    name: 'Polygon',
    emoji: '💜',
    description: 'Polygon PoS',
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    emoji: '🔵',
    description: 'Arbitrum One',
  },
  {
    id: 'base',
    name: 'Base',
    emoji: '🔷',
    description: 'Base (Coinbase L2)',
  },
];

// =============================================================================
// CHAIN_SELECT Step Handler
// =============================================================================

export class ChainSelectStepHandler extends BaseStepHandler {
  readonly step = WizardState.CHAIN_SELECT;

  constructor(logger: Logger) {
    super(logger.child({ step: 'CHAIN_SELECT' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const selectedChainIds = data.chains as string[] | undefined;

    if (!selectedChainIds || selectedChainIds.length === 0) {
      return this.errorResult('Please select at least one blockchain');
    }

    // Validate chains
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    // Convert to ChainConfig objects
    const chains: ChainConfig[] = selectedChainIds
      .map((chainId) => {
        const supported = SUPPORTED_CHAINS.find((c) => c.id === chainId);
        if (!supported) return null;
        return {
          chainId: supported.id,
          name: supported.name,
          enabled: true,
        } as ChainConfig;
      })
      .filter((c): c is ChainConfig => c !== null);

    this.log.info(
      { sessionId: context.sessionId, chainCount: chains.length },
      'CHAIN_SELECT step completed'
    );

    return this.successResult(
      undefined,
      `Selected ${chains.length} chain(s): ${chains.map((c) => c.name).join(', ')}`
    );
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const embed = this.createStepEmbed(
      'Select Blockchain(s)',
      `Select which blockchain(s) you want to use for eligibility checking.

**Community:** ${session.data.communityName ?? 'Not set'}

You can select multiple chains. Your members can hold assets on any of the selected chains to qualify for membership tiers.`,
      session
    );

    // Show currently selected chains
    if (session.data.chains && session.data.chains.length > 0) {
      (embed as { fields?: unknown[] }).fields = [
        {
          name: 'Currently Selected',
          value: session.data.chains.map((c) => {
            const chain = SUPPORTED_CHAINS.find((s) => s.id === c.chainId);
            return chain ? `${chain.emoji} ${chain.name}` : c.name;
          }).join('\n'),
          inline: false,
        },
      ];
    }

    // Get currently selected chain IDs
    const selectedIds = new Set(session.data.chains?.map((c) => c.chainId) ?? []);

    const selectMenu = createSelectMenu(
      'wizard:chain_select:chains',
      'Select blockchains...',
      SUPPORTED_CHAINS.map((chain) => ({
        label: chain.name,
        value: chain.id,
        description: chain.description,
        emoji: chain.emoji,
        default: selectedIds.has(chain.id),
      })),
      1,
      SUPPORTED_CHAINS.length // Allow selecting all
    );

    const components = [
      createActionRow([selectMenu]),
      createNavigationButtons('chain_select', true, selectedIds.size === 0),
    ];

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    _session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const chainIds = input.data.chains as string[] | undefined;

    if (!chainIds || chainIds.length === 0) {
      errors.push('At least one blockchain must be selected');
    } else {
      // Validate all chain IDs are valid
      const validIds = new Set(SUPPORTED_CHAINS.map((c) => c.id));
      const invalidIds = chainIds.filter((id) => !validIds.has(id as ChainId));
      if (invalidIds.length > 0) {
        errors.push(`Invalid chain ID(s): ${invalidIds.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Create a CHAIN_SELECT step handler.
 */
export function createChainSelectStepHandler(logger: Logger): ChainSelectStepHandler {
  return new ChainSelectStepHandler(logger);
}

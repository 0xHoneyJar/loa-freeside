/**
 * ASSET_CONFIG Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Third step: Asset configuration.
 * Users enter contract addresses for tokens/NFTs to check.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type { WizardSession, AssetConfig, AssetType, ChainId } from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import { randomUUID } from 'node:crypto';
import {
  BaseStepHandler,
  createButton,
  createSelectMenu,
  createActionRow,
  createNavigationButtons,
  ButtonStyle,
} from './base.js';

// =============================================================================
// Asset Type Options
// =============================================================================

const ASSET_TYPES: Array<{
  type: AssetType;
  label: string;
  emoji: string;
  description: string;
}> = [
  {
    type: 'erc721',
    label: 'NFT (ERC-721)',
    emoji: '🖼️',
    description: 'Standard NFT collection',
  },
  {
    type: 'erc20',
    label: 'Token (ERC-20)',
    emoji: '🪙',
    description: 'Fungible token',
  },
  {
    type: 'erc1155',
    label: 'Multi-Token (ERC-1155)',
    emoji: '🎮',
    description: 'Gaming/multi-token standard',
  },
  {
    type: 'native',
    label: 'Native Token',
    emoji: '⛽',
    description: 'Chain native token (ETH, MATIC, etc.)',
  },
];

// =============================================================================
// ASSET_CONFIG Step Handler
// =============================================================================

export class AssetConfigStepHandler extends BaseStepHandler {
  readonly step = WizardState.ASSET_CONFIG;

  constructor(logger: Logger) {
    super(logger.child({ step: 'ASSET_CONFIG' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const assets = data.assets as AssetConfig[] | undefined;

    if (!assets || assets.length === 0) {
      return this.errorResult('Please configure at least one asset');
    }

    // Validate assets
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    // Ensure all assets have IDs
    const processedAssets = assets.map((asset) => ({
      ...asset,
      id: asset.id || randomUUID(),
    }));

    this.log.info(
      { sessionId: context.sessionId, assetCount: processedAssets.length },
      'ASSET_CONFIG step completed'
    );

    return this.successResult(
      undefined,
      `Configured ${processedAssets.length} asset(s)`
    );
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const chains = session.data.chains ?? [];
    const assets = session.data.assets ?? [];

    const embed = this.createStepEmbed(
      'Configure Assets',
      `Configure the tokens or NFTs you want to use for eligibility checking.

**Selected Chains:** ${chains.map((c) => c.name).join(', ') || 'None'}

Click **Add Asset** to add a new token or NFT contract. You can add multiple assets across different chains.`,
      session
    );

    // Show existing assets
    if (assets.length > 0) {
      (embed as { fields?: unknown[] }).fields = [
        {
          name: `Configured Assets (${assets.length})`,
          value: assets
            .map((asset) => {
              const typeInfo = ASSET_TYPES.find((t) => t.type === asset.type);
              const emoji = typeInfo?.emoji ?? '📄';
              const address = asset.contractAddress
                ? `\`${asset.contractAddress.slice(0, 6)}...${asset.contractAddress.slice(-4)}\``
                : 'Native';
              return `${emoji} **${asset.name}** (${asset.symbol}) on ${asset.chainId}\n   ${address}`;
            })
            .join('\n\n'),
          inline: false,
        },
      ];
    }

    // Chain select for adding new asset
    const chainSelect = createSelectMenu(
      'wizard:asset_config:chain',
      'Select chain for new asset...',
      chains.map((chain) => ({
        label: chain.name,
        value: chain.chainId,
        description: `Add asset on ${chain.name}`,
      }))
    );

    // Asset type select
    const typeSelect = createSelectMenu(
      'wizard:asset_config:type',
      'Select asset type...',
      ASSET_TYPES.map((type) => ({
        label: type.label,
        value: type.type,
        description: type.description,
        emoji: type.emoji,
      }))
    );

    const components = [
      createActionRow([chainSelect]),
      createActionRow([typeSelect]),
      createActionRow([
        createButton('wizard:asset_config:add', 'Add Asset', ButtonStyle.Primary, false, '➕'),
        createButton('wizard:asset_config:remove', 'Remove Last', ButtonStyle.Secondary, assets.length === 0, '🗑️'),
      ]),
      createNavigationButtons('asset_config', true, assets.length === 0),
    ];

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const assets = input.data.assets as AssetConfig[] | undefined;

    if (!assets || assets.length === 0) {
      errors.push('At least one asset must be configured');
      return { valid: false, errors };
    }

    // Get valid chain IDs from session
    const validChainIds = new Set(session.data.chains?.map((c) => c.chainId) ?? []);

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]!;
      const prefix = `Asset ${i + 1}`;

      // Validate chain reference
      if (!validChainIds.has(asset.chainId)) {
        errors.push(`${prefix}: Chain "${asset.chainId}" is not selected`);
      }

      // Validate contract address for non-native assets
      if (asset.type !== 'native') {
        if (!asset.contractAddress) {
          errors.push(`${prefix}: Contract address is required`);
        } else if (!/^0x[a-fA-F0-9]{40}$/.test(asset.contractAddress)) {
          errors.push(`${prefix}: Invalid contract address format`);
        }
      }

      // Validate name and symbol
      if (!asset.name?.trim()) {
        errors.push(`${prefix}: Name is required`);
      }
      if (!asset.symbol?.trim()) {
        errors.push(`${prefix}: Symbol is required`);
      }

      // Validate decimals for ERC20
      if (asset.type === 'erc20') {
        if (asset.decimals === undefined || asset.decimals < 0 || asset.decimals > 18) {
          errors.push(`${prefix}: Decimals must be between 0 and 18`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Create an ASSET_CONFIG step handler.
 */
export function createAssetConfigStepHandler(logger: Logger): AssetConfigStepHandler {
  return new AssetConfigStepHandler(logger);
}

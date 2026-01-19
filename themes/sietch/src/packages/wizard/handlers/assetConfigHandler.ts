/**
 * Asset Config Handler - Token/NFT Configuration
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Allows user to configure tokens and NFTs for eligibility checking.
 *
 * @module packages/wizard/handlers/assetConfigHandler
 */

import type { WizardSession, AssetConfig, AssetType } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import type { StepHandler, StepHandlerResult, StepInput } from '../WizardEngine.js';

/**
 * Common asset templates.
 */
const ASSET_TEMPLATES: Record<string, Partial<AssetConfig>> = {
  native: {
    type: 'native',
    address: null,
    symbol: 'ETH',
  },
  erc20: {
    type: 'erc20',
    decimals: 18,
  },
  erc721: {
    type: 'erc721',
  },
};

/**
 * Validate an Ethereum address.
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Asset config step handler.
 *
 * Collects token/NFT configuration from user.
 * Supports multiple assets (up to 5).
 */
export const assetConfigHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  const currentAssets = session.data.assets ?? [];

  // Handle asset type selection
  if (input?.type === 'select' && input.customId?.includes('asset-type') && input.values?.length) {
    const assetType = input.values[0] as AssetType;

    // For native token, add directly
    if (assetType === 'native') {
      const nativeAsset: AssetConfig = {
        type: 'native',
        address: null,
        symbol: getChainNativeSymbol(session.data.chainId ?? 'ethereum'),
      };

      return {
        success: true,
        data: {
          assets: [...currentAssets, nativeAsset],
        },
        message: 'Added native token. Add more assets or continue.',
      };
    }

    // For other types, prompt for address
    return {
      success: true,
      data: {
        // Store pending asset type
        assets: currentAssets,
      },
      embed: {
        title: `📝 Enter ${assetType.toUpperCase()} Address`,
        description:
          `Please provide the contract address for your ${assetType} token.\n\n` +
          'Enter the full address starting with 0x.',
        color: 0x5865f2,
        fields: [
          {
            name: 'Asset Type',
            value: assetType.toUpperCase(),
            inline: true,
          },
          {
            name: 'Current Assets',
            value: currentAssets.length.toString(),
            inline: true,
          },
        ],
        footer: 'Step 2 of 8',
      },
      components: [
        {
          type: 'input',
          customId: `wizard:asset-address:${session.id}:${assetType}`,
          label: 'Contract Address',
          placeholder: '0x...',
          required: true,
          minLength: 42,
          maxLength: 42,
        },
      ],
    };
  }

  // Handle address input from modal
  if (input?.type === 'modal' && input.customId?.includes('asset-address') && input.fields) {
    const addressField = Object.entries(input.fields).find(([key]) => key.includes('address'));
    const address = addressField?.[1];

    // Extract asset type from customId
    const assetTypePart = input.customId.split(':').pop();
    const assetType = (assetTypePart ?? 'erc20') as AssetType;

    if (!address || !isValidAddress(address)) {
      return {
        success: false,
        error: 'Invalid address format. Please enter a valid Ethereum address (0x...).',
      };
    }

    const newAsset: AssetConfig = {
      type: assetType,
      address,
      symbol: assetType === 'erc721' ? 'NFT' : 'TOKEN',
      decimals: assetType === 'erc20' ? 18 : undefined,
    };

    return {
      success: true,
      data: {
        assets: [...currentAssets, newAsset],
      },
      message: `Added ${assetType} at ${address.slice(0, 10)}...${address.slice(-6)}`,
    };
  }

  // Handle "Continue" button
  if (input?.type === 'button' && input.customId?.includes('continue')) {
    if (currentAssets.length === 0) {
      return {
        success: false,
        error: 'Please add at least one asset before continuing.',
      };
    }

    return {
      success: true,
      nextState: WizardState.ELIGIBILITY_RULES,
      message: 'Asset configuration complete. Now let\'s set up eligibility rules.',
    };
  }

  // Handle "Remove" button
  if (input?.type === 'button' && input.customId?.includes('remove-asset')) {
    const indexStr = input.customId.split(':').pop();
    const index = parseInt(indexStr ?? '0', 10);

    if (index >= 0 && index < currentAssets.length) {
      const updatedAssets = currentAssets.filter((_, i) => i !== index);
      return {
        success: true,
        data: { assets: updatedAssets },
        message: 'Asset removed.',
      };
    }
  }

  // Generate asset configuration UI
  const assetList = currentAssets.length > 0
    ? currentAssets
        .map((a, i) => `${i + 1}. ${a.type.toUpperCase()}: ${a.address ?? 'Native'} (${a.symbol})`)
        .join('\n')
    : '_No assets configured yet_';

  return {
    success: true,
    embed: {
      title: '🪙 Step 2: Asset Configuration',
      description:
        'Configure the tokens and NFTs that determine community eligibility.\n\n' +
        'Members must hold one or more of these assets to gain access.\n\n' +
        '**Current Assets:**\n' +
        assetList,
      color: 0x5865f2,
      fields: [
        {
          name: '🔗 Chain',
          value: session.data.chainId ?? 'Not selected',
          inline: true,
        },
        {
          name: '📊 Assets Count',
          value: `${currentAssets.length}/5`,
          inline: true,
        },
      ],
      footer: 'Step 2 of 8',
    },
    components: currentAssets.length < 5
      ? [
          {
            type: 'select',
            customId: `wizard:asset-type:${session.id}`,
            placeholder: 'Add an asset...',
            options: [
              { label: '💰 Native Token', value: 'native', description: 'ETH, BERA, etc.' },
              { label: '🪙 ERC-20 Token', value: 'erc20', description: 'Fungible token' },
              { label: '🖼️ ERC-721 NFT', value: 'erc721', description: 'Non-fungible token' },
              { label: '🎨 ERC-1155', value: 'erc1155', description: 'Multi-token standard' },
            ],
          },
          {
            type: 'button',
            customId: `wizard:continue:${session.id}`,
            label: 'Continue →',
            style: currentAssets.length > 0 ? 'primary' : 'secondary',
            disabled: currentAssets.length === 0,
          },
        ]
      : [
          {
            type: 'button',
            customId: `wizard:continue:${session.id}`,
            label: 'Continue →',
            style: 'primary',
          },
        ],
  };
};

/**
 * Get native token symbol for chain.
 */
function getChainNativeSymbol(chainId: string): string {
  const symbols: Record<string, string> = {
    berachain: 'BERA',
    ethereum: 'ETH',
    arbitrum: 'ETH',
    base: 'ETH',
    polygon: 'MATIC',
    optimism: 'ETH',
    avalanche: 'AVAX',
  };
  return symbols[chainId] ?? 'ETH';
}

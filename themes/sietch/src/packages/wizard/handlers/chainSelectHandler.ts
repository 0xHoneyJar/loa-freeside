/**
 * Chain Select Handler - Blockchain Selection
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Allows user to select the blockchain network for their community.
 *
 * @module packages/wizard/handlers/chainSelectHandler
 */

import { WizardSession, ChainId } from '../WizardSession.js';
import { WizardState } from '../WizardState.js';
import { StepHandler, StepHandlerResult, StepInput, WizardSelectComponent } from '../WizardEngine.js';

/**
 * Supported chains with metadata.
 */
const SUPPORTED_CHAINS: Array<{
  id: ChainId;
  name: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'berachain',
    name: 'Berachain',
    description: 'Proof of Liquidity L1 blockchain',
    icon: '🐻',
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    description: 'The original smart contract platform',
    icon: '⟠',
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    description: 'Ethereum L2 with low fees',
    icon: '🔵',
  },
  {
    id: 'base',
    name: 'Base',
    description: 'Coinbase L2 on Ethereum',
    icon: '🔷',
  },
  {
    id: 'polygon',
    name: 'Polygon',
    description: 'Ethereum sidechain',
    icon: '💜',
  },
  {
    id: 'optimism',
    name: 'Optimism',
    description: 'Ethereum L2 Optimistic Rollup',
    icon: '🔴',
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    description: 'High-throughput L1',
    icon: '🔺',
  },
];

/**
 * Chain select step handler.
 *
 * Displays chain selection dropdown.
 * Advances to ASSET_CONFIG when chain is selected.
 */
export const chainSelectHandler: StepHandler = async (
  session: WizardSession,
  input?: StepInput
): Promise<StepHandlerResult> => {
  // Process chain selection
  if (input?.type === 'select' && input.customId?.includes('chain') && input.values?.length) {
    const selectedChain = input.values[0] as ChainId;

    // Validate selection
    if (!SUPPORTED_CHAINS.find((c) => c.id === selectedChain)) {
      return {
        success: false,
        error: `Invalid chain selection: ${selectedChain}`,
      };
    }

    const chainInfo = SUPPORTED_CHAINS.find((c) => c.id === selectedChain);

    return {
      success: true,
      nextState: WizardState.ASSET_CONFIG,
      data: {
        chainId: selectedChain,
      },
      message: `Selected ${chainInfo?.name ?? selectedChain}. Now let's configure your assets.`,
    };
  }

  // Generate chain selection UI
  const selectOptions = SUPPORTED_CHAINS.map((chain) => ({
    label: `${chain.icon} ${chain.name}`,
    value: chain.id,
    description: chain.description,
    default: session.data.chainId === chain.id,
  }));

  const selectComponent: WizardSelectComponent = {
    type: 'select',
    customId: `wizard:chain:${session.id}`,
    placeholder: 'Select a blockchain...',
    options: selectOptions,
  };

  return {
    success: true,
    embed: {
      title: '⛓️ Step 1: Select Blockchain',
      description:
        'Choose the blockchain network where your community tokens or NFTs are deployed.\n\n' +
        "This determines which chain we'll use to verify member eligibility.",
      color: 0x5865f2,
      fields: [
        {
          name: '💡 Tip',
          value:
            'Select the chain where your governance token, membership NFT, or staking contract is deployed.',
          inline: false,
        },
      ],
      footer: 'Step 1 of 8',
    },
    components: [selectComponent],
  };
};

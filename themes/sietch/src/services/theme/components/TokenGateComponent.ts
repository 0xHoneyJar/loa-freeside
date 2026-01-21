/**
 * Token Gate Component Definition
 *
 * Component for gating content based on token/NFT ownership.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2.1 Token Gate Component
 */

import type { ComponentRegistration } from '../ComponentRegistry.js';
import type { TokenGateProps } from '../../../types/theme-component.types.js';

/**
 * Token Gate Component
 *
 * Shows content only to users who hold the required tokens/NFTs.
 */
export const TokenGateComponent: ComponentRegistration = {
  type: 'token-gate',
  definition: {
    type: 'token-gate',
    name: 'Token Gate',
    description: 'Show content only to token/NFT holders',
    category: 'web3',
    icon: 'lock',
    propsSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['token-gate'],
          description: 'Component type identifier',
        },
        gateConfig: {
          type: 'object',
          description: 'Gate configuration with token requirements',
          properties: {
            type: {
              type: 'string',
              enum: ['token', 'nft', 'multi'],
              description: 'Gate type',
            },
            contractId: {
              type: 'string',
              description: 'Contract binding ID',
            },
            minBalance: {
              type: 'string',
              description: 'Minimum balance required (bigint as string)',
            },
          },
        },
        showBalance: {
          type: 'boolean',
          default: false,
          description: 'Show user token balance',
        },
        lockedContent: {
          type: 'string',
          description: 'Content shown when gate requirements not met',
        },
        unlockedContent: {
          type: 'string',
          description: 'Content shown when gate requirements met',
        },
        showRequirements: {
          type: 'boolean',
          default: true,
          description: 'Show what tokens are required',
        },
      },
      required: ['type', 'gateConfig'],
    },
    defaultProps: {
      type: 'token-gate',
      gateConfig: {
        type: 'token',
      },
      showBalance: false,
      showRequirements: true,
    } as TokenGateProps,
    minWidth: 2,
    minHeight: 2,
    requiresWeb3: true,
    requiresContract: true,
  },
};

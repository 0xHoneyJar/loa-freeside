/**
 * Profile Card Component Definition
 *
 * Component for displaying member profiles with Web3 data.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2.4 Profile Card Component
 */

import type { ComponentRegistration } from '../ComponentRegistry.js';
import type { ProfileCardProps } from '../../../types/theme-component.types.js';

/**
 * Profile Card Component
 *
 * Displays member profile with optional Web3 data integration.
 */
export const ProfileCardComponent: ComponentRegistration = {
  type: 'profile-card',
  definition: {
    type: 'profile-card',
    name: 'Profile Card',
    description: 'Display member profile with Web3 data',
    category: 'web3',
    icon: 'user',
    propsSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['profile-card'],
          description: 'Component type identifier',
        },
        showAvatar: {
          type: 'boolean',
          default: true,
          description: 'Show member avatar',
        },
        showWallet: {
          type: 'boolean',
          default: true,
          description: 'Show connected wallet address',
        },
        showBalance: {
          type: 'boolean',
          default: false,
          description: 'Show token balance',
        },
        contractId: {
          type: 'string',
          description: 'Contract binding ID for balance display',
        },
        showRoles: {
          type: 'boolean',
          default: true,
          description: 'Show Discord roles',
        },
        showStats: {
          type: 'boolean',
          default: false,
          description: 'Show community statistics',
        },
        customFields: {
          type: 'array',
          description: 'Custom fields to display',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'Field label',
              },
              source: {
                type: 'string',
                enum: ['contract', 'api', 'static'],
                description: 'Data source type',
              },
              contractId: {
                type: 'string',
                description: 'Contract binding ID',
              },
              method: {
                type: 'string',
                description: 'Contract method to call',
              },
              apiEndpoint: {
                type: 'string',
                description: 'API endpoint for data',
              },
              staticValue: {
                type: 'string',
                description: 'Static value to display',
              },
            },
          },
        },
      },
      required: ['type'],
    },
    defaultProps: {
      type: 'profile-card',
      showAvatar: true,
      showWallet: true,
      showBalance: false,
      showRoles: true,
      showStats: false,
    } as ProfileCardProps,
    minWidth: 2,
    minHeight: 2,
    requiresWeb3: false,
    requiresContract: false,
  },
};

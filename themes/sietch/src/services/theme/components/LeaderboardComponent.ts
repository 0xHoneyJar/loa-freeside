/**
 * Leaderboard Component Definition
 *
 * Component for displaying community rankings.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2.3 Leaderboard Component
 */

import type { ComponentRegistration } from '../ComponentRegistry.js';
import type { LeaderboardProps } from '../../../types/theme-component.types.js';

/**
 * Leaderboard Component
 *
 * Displays community rankings by holdings, activity, or custom scores.
 */
export const LeaderboardComponent: ComponentRegistration = {
  type: 'leaderboard',
  definition: {
    type: 'leaderboard',
    name: 'Leaderboard',
    description: 'Rank members by holdings, activity, or custom scores',
    category: 'web3',
    icon: 'trophy',
    propsSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['leaderboard'],
          description: 'Component type identifier',
        },
        title: {
          type: 'string',
          default: 'Leaderboard',
          description: 'Leaderboard title',
        },
        dataSource: {
          type: 'object',
          description: 'Data source configuration',
          properties: {
            type: {
              type: 'string',
              enum: ['points', 'tokens', 'nfts', 'custom'],
              description: 'Data source type',
            },
            contractId: {
              type: 'string',
              description: 'Contract binding ID for token/NFT data',
            },
            customEndpoint: {
              type: 'string',
              description: 'Custom API endpoint for rankings',
            },
            sortOrder: {
              type: 'string',
              enum: ['asc', 'desc'],
              default: 'desc',
              description: 'Sort order',
            },
          },
        },
        maxEntries: {
          type: 'number',
          minimum: 5,
          maximum: 100,
          default: 10,
          description: 'Maximum entries to show',
        },
        showRank: {
          type: 'boolean',
          default: true,
          description: 'Show rank numbers',
        },
        showAvatar: {
          type: 'boolean',
          default: true,
          description: 'Show member avatars',
        },
        showChange: {
          type: 'boolean',
          default: false,
          description: 'Show rank change indicators',
        },
        refreshInterval: {
          type: 'number',
          minimum: 60,
          maximum: 3600,
          default: 300,
          description: 'Auto-refresh interval in seconds',
        },
      },
      required: ['type', 'dataSource'],
    },
    defaultProps: {
      type: 'leaderboard',
      title: 'Leaderboard',
      dataSource: {
        type: 'points',
        sortOrder: 'desc',
      },
      maxEntries: 10,
      showRank: true,
      showAvatar: true,
      showChange: false,
      refreshInterval: 300,
    } as LeaderboardProps,
    minWidth: 2,
    minHeight: 4,
    requiresWeb3: false,
    requiresContract: false,
  },
};

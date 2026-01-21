/**
 * NFT Gallery Component Definition
 *
 * Component for displaying NFT collections.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2.2 NFT Gallery Component
 */

import type { ComponentRegistration } from '../ComponentRegistry.js';
import type { NFTGalleryProps } from '../../../types/theme-component.types.js';

/**
 * NFT Gallery Component
 *
 * Displays NFTs from a collection with various layout options.
 */
export const NFTGalleryComponent: ComponentRegistration = {
  type: 'nft-gallery',
  definition: {
    type: 'nft-gallery',
    name: 'NFT Gallery',
    description: 'Display NFTs from a collection',
    category: 'web3',
    icon: 'grid',
    propsSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['nft-gallery'],
          description: 'Component type identifier',
        },
        contractId: {
          type: 'string',
          description: 'Contract binding ID for the NFT collection',
        },
        layout: {
          type: 'string',
          enum: ['grid', 'carousel', 'masonry'],
          default: 'grid',
          description: 'Gallery layout style',
        },
        columns: {
          type: 'number',
          enum: [2, 3, 4, 6],
          default: 4,
          description: 'Number of columns in grid layout',
        },
        showMetadata: {
          type: 'boolean',
          default: true,
          description: 'Show NFT metadata (name, traits)',
        },
        showOwner: {
          type: 'boolean',
          default: false,
          description: 'Show NFT owner',
        },
        maxItems: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          default: 20,
          description: 'Maximum NFTs to display',
        },
        filterByTrait: {
          type: 'object',
          description: 'Filter NFTs by trait',
          properties: {
            traitType: {
              type: 'string',
              description: 'Trait type to filter by',
            },
            values: {
              type: 'array',
              items: { type: 'string' },
              description: 'Trait values to include',
            },
          },
        },
      },
      required: ['type', 'contractId'],
    },
    defaultProps: {
      type: 'nft-gallery',
      contractId: '',
      layout: 'grid',
      columns: 4,
      showMetadata: true,
      showOwner: false,
      maxItems: 20,
    } as NFTGalleryProps,
    minWidth: 3,
    minHeight: 3,
    requiresWeb3: true,
    requiresContract: true,
  },
};

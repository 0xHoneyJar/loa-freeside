/**
 * Layout Container Component Definition
 *
 * Component for grouping and arranging other components.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2.6 Layout Container Component
 */

import type { ComponentRegistration } from '../ComponentRegistry.js';
import type { LayoutContainerProps } from '../../../types/theme-component.types.js';

/**
 * Layout Container Component
 *
 * Groups and arranges other components with flexible layout options.
 */
export const LayoutContainerComponent: ComponentRegistration = {
  type: 'layout-container',
  definition: {
    type: 'layout-container',
    name: 'Container',
    description: 'Group and arrange components',
    category: 'layout',
    icon: 'layout',
    propsSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['layout-container'],
          description: 'Component type identifier',
        },
        direction: {
          type: 'string',
          enum: ['horizontal', 'vertical'],
          default: 'vertical',
          description: 'Content flow direction',
        },
        gap: {
          type: 'string',
          enum: ['none', 'sm', 'md', 'lg'],
          default: 'md',
          description: 'Gap between children',
        },
        padding: {
          type: 'string',
          enum: ['none', 'sm', 'md', 'lg'],
          default: 'md',
          description: 'Internal padding',
        },
        background: {
          type: 'string',
          enum: ['transparent', 'surface', 'primary', 'custom'],
          default: 'transparent',
          description: 'Background style',
        },
        customBackground: {
          type: 'string',
          description: 'Custom background color (hex)',
        },
        borderRadius: {
          type: 'string',
          enum: ['none', 'sm', 'md', 'lg'],
          default: 'none',
          description: 'Border radius',
        },
        children: {
          type: 'array',
          description: 'Nested components',
          items: {
            type: 'object',
            description: 'Component instance',
          },
        },
      },
      required: ['type', 'children'],
    },
    defaultProps: {
      type: 'layout-container',
      direction: 'vertical',
      gap: 'md',
      padding: 'md',
      background: 'transparent',
      borderRadius: 'none',
      children: [],
    } as LayoutContainerProps,
    minWidth: 1,
    minHeight: 1,
    requiresWeb3: false,
    requiresContract: false,
  },
};

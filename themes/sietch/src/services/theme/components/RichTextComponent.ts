/**
 * Rich Text Component Definition
 *
 * Component for formatted text content with markdown support.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2.5 Rich Text Component
 */

import type { ComponentRegistration } from '../ComponentRegistry.js';
import type { RichTextProps } from '../../../types/theme-component.types.js';

/**
 * Rich Text Component
 *
 * Displays formatted text with markdown support.
 */
export const RichTextComponent: ComponentRegistration = {
  type: 'rich-text',
  definition: {
    type: 'rich-text',
    name: 'Rich Text',
    description: 'Formatted text content with markdown support',
    category: 'content',
    icon: 'text',
    propsSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['rich-text'],
          description: 'Component type identifier',
        },
        content: {
          type: 'string',
          default: 'Enter your content here...',
          description: 'Markdown content',
        },
        textAlign: {
          type: 'string',
          enum: ['left', 'center', 'right'],
          default: 'left',
          description: 'Text alignment',
        },
        maxWidth: {
          type: 'string',
          enum: ['sm', 'md', 'lg', 'full'],
          default: 'full',
          description: 'Maximum content width',
        },
      },
      required: ['type', 'content'],
    },
    defaultProps: {
      type: 'rich-text',
      content: 'Enter your content here...',
      textAlign: 'left',
      maxWidth: 'full',
    } as RichTextProps,
    minWidth: 1,
    minHeight: 1,
    requiresWeb3: false,
    requiresContract: false,
  },
};

/**
 * Rich Text Component Renderer
 *
 * Server-side HTML renderer for markdown content.
 * Sprint 6: Component System - Preview Engine
 */

import type { RichTextProps } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import { markdownToHtml, componentClass, cssVar } from './BaseRenderer.js';

/**
 * Rich Text Renderer
 */
export class RichTextRenderer implements ComponentRenderer<RichTextProps> {
  getType(): string {
    return 'rich-text';
  }

  render(props: RichTextProps, _context: RenderContext): string {
    const textAlign = props.textAlign ?? 'left';
    const maxWidth = props.maxWidth ?? 'full';
    const className = componentClass('rich-text', `align-${textAlign}`, `width-${maxWidth}`);

    const htmlContent = markdownToHtml(props.content);

    return `
      <div class="${className}" data-component="rich-text">
        <div class="theme-rich-text__content">
          ${htmlContent}
        </div>
      </div>
    `;
  }

  getStyles(_props: RichTextProps): string {
    return `
      .theme-rich-text {
        width: 100%;
      }
      .theme-rich-text__content {
        color: ${cssVar('text-primary', '#111827')};
        line-height: 1.6;
      }
      .theme-rich-text__content p {
        margin: 0 0 1rem 0;
      }
      .theme-rich-text__content p:last-child {
        margin-bottom: 0;
      }
      .theme-rich-text__content strong {
        font-weight: 600;
      }
      .theme-rich-text__content em {
        font-style: italic;
      }
      .theme-rich-text__content code {
        font-family: ui-monospace, monospace;
        font-size: 0.875em;
        background: ${cssVar('surface-muted', '#f3f4f6')};
        padding: 0.125rem 0.25rem;
        border-radius: 0.25rem;
      }
      .theme-rich-text__content a {
        color: ${cssVar('primary', '#2563eb')};
        text-decoration: underline;
      }
      .theme-rich-text__content a:hover {
        color: ${cssVar('primary-dark', '#1d4ed8')};
      }

      /* Alignment variants */
      .theme-rich-text--align-left .theme-rich-text__content {
        text-align: left;
      }
      .theme-rich-text--align-center .theme-rich-text__content {
        text-align: center;
      }
      .theme-rich-text--align-right .theme-rich-text__content {
        text-align: right;
      }

      /* Width variants */
      .theme-rich-text--width-sm {
        max-width: 32rem;
        margin-left: auto;
        margin-right: auto;
      }
      .theme-rich-text--width-md {
        max-width: 48rem;
        margin-left: auto;
        margin-right: auto;
      }
      .theme-rich-text--width-lg {
        max-width: 64rem;
        margin-left: auto;
        margin-right: auto;
      }
      .theme-rich-text--width-full {
        max-width: none;
      }
    `;
  }
}

export const richTextRenderer = new RichTextRenderer();

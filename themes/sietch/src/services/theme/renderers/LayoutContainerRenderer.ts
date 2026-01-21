/**
 * Layout Container Component Renderer
 *
 * Server-side HTML renderer for layout containers.
 * Sprint 6: Component System - Preview Engine
 */

import type { LayoutContainerProps, ComponentInstance } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import { componentClass, cssVar, sizeToPixels } from './BaseRenderer.js';

/**
 * Layout Container Renderer
 *
 * Note: This renderer needs access to other renderers to render children.
 * The renderChildren function is injected by the PreviewService.
 */
export class LayoutContainerRenderer implements ComponentRenderer<LayoutContainerProps> {
  private renderChildren?: (children: ComponentInstance[], context: RenderContext) => string;

  getType(): string {
    return 'layout-container';
  }

  /**
   * Set the child renderer function (injected by PreviewService)
   */
  setChildRenderer(renderer: (children: ComponentInstance[], context: RenderContext) => string): void {
    this.renderChildren = renderer;
  }

  render(props: LayoutContainerProps, context: RenderContext): string {
    const direction = props.direction ?? 'vertical';
    const gap = props.gap ?? 'md';
    const padding = props.padding ?? 'md';
    const background = props.background ?? 'transparent';
    const borderRadius = props.borderRadius ?? 'none';

    const className = componentClass('layout-container', direction);

    // Render children if we have a renderer
    let childrenHtml = '';
    if (props.children && props.children.length > 0) {
      if (this.renderChildren) {
        childrenHtml = this.renderChildren(props.children, context);
      } else {
        // Fallback: show placeholder
        childrenHtml = props.children
          .map(
            (child) =>
              `<div class="theme-layout-container__placeholder" data-type="${child.type}">[${child.type}]</div>`
          )
          .join('');
      }
    }

    // Calculate background style
    let bgStyle = '';
    if (background === 'custom' && props.customBackground) {
      bgStyle = `background-color: ${props.customBackground};`;
    }

    return `
      <div
        class="${className}"
        data-component="layout-container"
        style="--gap: ${sizeToPixels(gap)}; --padding: ${sizeToPixels(padding)}; ${bgStyle}"
        data-background="${background}"
        data-border-radius="${borderRadius}"
      >
        <div class="theme-layout-container__inner">
          ${childrenHtml}
        </div>
      </div>
    `;
  }

  getStyles(_props: LayoutContainerProps): string {
    return `
      .theme-layout-container {
        padding: var(--padding, 1rem);
      }
      .theme-layout-container[data-background="surface"] {
        background: ${cssVar('surface', '#ffffff')};
      }
      .theme-layout-container[data-background="primary"] {
        background: ${cssVar('primary-light', '#dbeafe')};
      }
      .theme-layout-container[data-border-radius="sm"] {
        border-radius: 0.25rem;
      }
      .theme-layout-container[data-border-radius="md"] {
        border-radius: 0.5rem;
      }
      .theme-layout-container[data-border-radius="lg"] {
        border-radius: 1rem;
      }
      .theme-layout-container__inner {
        display: flex;
        gap: var(--gap, 1rem);
      }
      .theme-layout-container--vertical .theme-layout-container__inner {
        flex-direction: column;
      }
      .theme-layout-container--horizontal .theme-layout-container__inner {
        flex-direction: row;
        flex-wrap: wrap;
      }
      .theme-layout-container__placeholder {
        padding: 1rem;
        background: ${cssVar('surface-muted', '#f3f4f6')};
        border: 2px dashed ${cssVar('border-color', '#e5e7eb')};
        border-radius: 0.25rem;
        color: ${cssVar('text-muted', '#6b7280')};
        text-align: center;
        font-size: 0.875rem;
      }
    `;
  }
}

export const layoutContainerRenderer = new LayoutContainerRenderer();

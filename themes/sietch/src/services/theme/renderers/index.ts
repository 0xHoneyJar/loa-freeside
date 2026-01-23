/**
 * Component Renderers Index
 *
 * Exports all component renderers and the renderer registry.
 * Sprint 6: Component System - Preview Engine
 */

import type { ComponentType, ComponentProps } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import { tokenGateRenderer } from './TokenGateRenderer.js';
import { nftGalleryRenderer } from './NFTGalleryRenderer.js';
import { leaderboardRenderer } from './LeaderboardRenderer.js';
import { profileCardRenderer } from './ProfileCardRenderer.js';
import { richTextRenderer } from './RichTextRenderer.js';
import { layoutContainerRenderer } from './LayoutContainerRenderer.js';

// =============================================================================
// Renderer Registry
// =============================================================================

/**
 * Map of component type to renderer
 */
const rendererRegistry = new Map<ComponentType, ComponentRenderer<any>>([
  ['token-gate', tokenGateRenderer],
  ['nft-gallery', nftGalleryRenderer],
  ['leaderboard', leaderboardRenderer],
  ['profile-card', profileCardRenderer],
  ['rich-text', richTextRenderer],
  ['layout-container', layoutContainerRenderer],
]);

/**
 * Get renderer for a component type
 */
export function getRenderer(type: ComponentType): ComponentRenderer<any> | undefined {
  return rendererRegistry.get(type);
}

/**
 * Render a component to HTML
 */
export function renderComponent(
  type: ComponentType,
  props: ComponentProps,
  context: RenderContext
): string {
  const renderer = getRenderer(type);
  if (!renderer) {
    return `<div class="theme-component-error">Unknown component type: ${type}</div>`;
  }
  return renderer.render(props, context);
}

/**
 * Get CSS styles for a component
 */
export function getComponentStyles(type: ComponentType, props: ComponentProps): string {
  const renderer = getRenderer(type);
  if (!renderer) {
    return '';
  }
  return renderer.getStyles(props);
}

/**
 * Get all registered renderers
 */
export function getAllRenderers(): ComponentRenderer<any>[] {
  return Array.from(rendererRegistry.values());
}

/**
 * Collect all styles from registered renderers
 */
export function collectAllStyles(): string {
  const styles: string[] = [];
  for (const renderer of rendererRegistry.values()) {
    // Get default styles (with empty/default props)
    const defaultStyles = renderer.getStyles({} as any);
    if (defaultStyles) {
      styles.push(`/* ${renderer.getType()} */\n${defaultStyles}`);
    }
  }
  return styles.join('\n\n');
}

// =============================================================================
// Re-exports
// =============================================================================

export * from './BaseRenderer.js';
export { tokenGateRenderer } from './TokenGateRenderer.js';
export { nftGalleryRenderer } from './NFTGalleryRenderer.js';
export { leaderboardRenderer } from './LeaderboardRenderer.js';
export { profileCardRenderer } from './ProfileCardRenderer.js';
export { richTextRenderer } from './RichTextRenderer.js';
export { layoutContainerRenderer } from './LayoutContainerRenderer.js';

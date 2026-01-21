/**
 * Theme Preview Service
 *
 * Service for generating complete theme preview HTML.
 * Sprint 6: Component System - Preview Engine
 *
 * @see grimoires/loa/sdd.md §7. Component System
 */

import { logger } from '../../utils/logger.js';
import type {
  ComponentInstance,
  ComponentType,
  ComponentProps,
} from '../../types/theme-component.types.js';
import type { Theme, ThemePage, ThemeBranding } from '../../types/theme.types.js';
import type { RenderContext, ThemeBranding as RenderBranding } from './renderers/BaseRenderer.js';
import {
  renderComponent,
  collectAllStyles,
  layoutContainerRenderer,
} from './renderers/index.js';

// =============================================================================
// Preview Service Types
// =============================================================================

/**
 * Preview generation options
 */
export interface PreviewOptions {
  /** Page to preview (optional, defaults to first page) */
  pageId?: string;

  /** Viewport mode */
  viewport?: 'desktop' | 'tablet' | 'mobile';

  /** Use mock data for Web3 components */
  mockMode?: boolean;

  /** Mock wallet address for gating preview */
  mockWallet?: string;

  /** Mock token balances */
  mockBalances?: Record<string, string>;

  /** Mock NFT holdings */
  mockNftHoldings?: Record<string, string[]>;

  /** Include full HTML document wrapper */
  fullDocument?: boolean;

  /**
   * CSP nonce for inline styles
   * SECURITY: Required for CRIT-2 CSP remediation
   */
  cspNonce?: string;
}

/**
 * Preview result
 */
export interface PreviewResult {
  /** Generated HTML */
  html: string;

  /** Generated CSS */
  css: string;

  /** Page metadata */
  page: {
    id: string;
    name: string;
    slug: string;
  };

  /** Viewport used */
  viewport: 'desktop' | 'tablet' | 'mobile';

  /** Whether mock mode was used */
  mockMode: boolean;

  /** Generation timestamp */
  generatedAt: string;
}

// =============================================================================
// Preview Service
// =============================================================================

/**
 * ThemePreviewService - Generates theme preview HTML
 */
export class ThemePreviewService {
  /**
   * Generate preview for a theme
   */
  generatePreview(theme: Theme, options: PreviewOptions = {}): PreviewResult {
    const viewport = options.viewport ?? 'desktop';
    const mockMode = options.mockMode ?? true;

    // Find page to render
    const page = this.findPage(theme, options.pageId);
    if (!page) {
      throw new Error(`Page not found: ${options.pageId ?? 'default'}`);
    }

    // Create render context
    const context = this.createRenderContext(theme, page, options);

    // Setup layout container child renderer
    layoutContainerRenderer.setChildRenderer((children, ctx) =>
      this.renderChildren(children, ctx)
    );

    // Collect all CSS
    const css = this.generateCss(theme.branding);

    // Render page components
    const componentsHtml = this.renderPageComponents(page, context);

    // Build final HTML
    const html = options.fullDocument
      ? this.wrapInDocument(theme, page, componentsHtml, css, viewport, options.cspNonce)
      : componentsHtml;

    logger.debug(
      { themeId: theme.id, pageId: page.id, viewport, mockMode },
      'Preview generated'
    );

    return {
      html,
      css,
      page: {
        id: page.id,
        name: page.name,
        slug: page.slug,
      },
      viewport,
      mockMode,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Find page to render
   */
  private findPage(theme: Theme, pageId?: string): ThemePage | undefined {
    if (!theme.pages || theme.pages.length === 0) {
      return undefined;
    }

    if (pageId) {
      return theme.pages.find((p) => p.id === pageId);
    }

    // Return home page or first page
    return theme.pages.find((p) => p.slug === 'home') ?? theme.pages[0];
  }

  /**
   * Create render context
   */
  private createRenderContext(
    theme: Theme,
    page: ThemePage,
    options: PreviewOptions
  ): RenderContext {
    const branding = this.convertBranding(theme.branding);

    return {
      theme: {
        id: theme.id,
        name: theme.name,
        branding,
      },
      page: {
        id: page.id,
        name: page.name,
        slug: page.slug,
      },
      user: options.mockMode
        ? {
            wallet: options.mockWallet ?? '0x1234567890abcdef1234567890abcdef12345678',
            roles: ['Member', 'Verified'],
            balances: options.mockBalances ?? {
              default: '1000000000000000000',
            },
            nftHoldings: options.mockNftHoldings ?? {
              default: ['1', '2', '3'],
            },
          }
        : undefined,
      mockMode: options.mockMode ?? true,
      viewport: options.viewport ?? 'desktop',
    };
  }

  /**
   * Convert theme branding to render branding
   */
  private convertBranding(branding: ThemeBranding): RenderBranding {
    // Map border radius (handle 'full' as 'lg')
    const borderRadius = branding.borderRadius === 'full' ? 'lg' : branding.borderRadius;

    return {
      primaryColor: branding.colors.primary,
      secondaryColor: branding.colors.secondary,
      backgroundColor: branding.colors.background,
      textColor: branding.colors.text,
      accentColor: branding.colors.accent,
      fontFamily: branding.fonts.body.family,
      borderRadius: borderRadius ?? 'md',
    };
  }

  /**
   * Render all page components
   */
  private renderPageComponents(page: ThemePage, context: RenderContext): string {
    if (!page.components || page.components.length === 0) {
      return '<div class="theme-preview-empty">No components on this page</div>';
    }

    return `
      <div class="theme-preview-content">
        ${this.renderChildren(page.components, context)}
      </div>
    `;
  }

  /**
   * Render array of component instances
   */
  private renderChildren(components: ComponentInstance[], context: RenderContext): string {
    return components
      .map((component) => {
        const componentHtml = renderComponent(
          component.type as ComponentType,
          component.props as ComponentProps,
          context
        );

        // Wrap in grid cell with positioning
        const { x, y, width, height } = component.position;
        const gridStyle = `grid-column: ${x + 1} / span ${width}; grid-row: ${y + 1} / span ${typeof height === 'number' ? height : 1};`;

        return `
          <div class="theme-grid-cell" style="${gridStyle}" data-component-id="${component.id}">
            ${componentHtml}
          </div>
        `;
      })
      .join('');
  }

  /**
   * Generate CSS with theme branding
   */
  private generateCss(branding: ThemeBranding): string {
    const componentStyles = collectAllStyles();

    return `
/* Theme Variables */
:root {
  --theme-primary: ${branding.colors.primary};
  --theme-primary-light: ${this.lightenColor(branding.colors.primary, 0.9)};
  --theme-primary-dark: ${this.darkenColor(branding.colors.primary, 0.2)};
  --theme-secondary: ${branding.colors.secondary};
  --theme-background: ${branding.colors.background};
  --theme-surface: ${branding.colors.surface ?? '#ffffff'};
  --theme-surface-muted: ${this.lightenColor(branding.colors.background, 0.05)};
  --theme-surface-hover: ${this.darkenColor(branding.colors.surface ?? '#ffffff', 0.02)};
  --theme-text-primary: ${branding.colors.text};
  --theme-text-secondary: ${this.lightenColor(branding.colors.text, 0.3)};
  --theme-text-muted: ${this.lightenColor(branding.colors.text, 0.5)};
  --theme-accent: ${branding.colors.accent};
  --theme-border-color: ${this.lightenColor(branding.colors.text, 0.85)};
  --theme-border-radius: ${this.getBorderRadius(branding.borderRadius === 'full' ? 'lg' : branding.borderRadius)};
  --theme-font-primary: ${branding.fonts.body.family};
  --theme-font-heading: ${branding.fonts.heading.family};
}

/* Base Theme Styles */
.theme-preview {
  font-family: var(--theme-font-primary);
  color: var(--theme-text-primary);
  background: var(--theme-background);
  min-height: 100%;
}

.theme-preview-content {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1rem;
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.theme-grid-cell {
  min-height: 0;
}

.theme-preview-empty {
  grid-column: 1 / -1;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--theme-text-muted);
  background: var(--theme-surface-muted);
  border-radius: var(--theme-border-radius);
}

.theme-component-error {
  padding: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  color: #dc2626;
  font-size: 0.875rem;
}

/* Viewport Responsive */
@media (max-width: 1024px) {
  .theme-preview-content {
    grid-template-columns: repeat(8, 1fr);
  }
}

@media (max-width: 768px) {
  .theme-preview-content {
    grid-template-columns: repeat(4, 1fr);
    padding: 1rem;
  }
}

@media (max-width: 480px) {
  .theme-preview-content {
    grid-template-columns: 1fr;
  }
}

/* Component Styles */
${componentStyles}
    `.trim();
  }

  /**
   * Wrap content in full HTML document
   * SECURITY: Includes CSP nonce for inline styles (CRIT-2 remediation)
   */
  private wrapInDocument(
    theme: Theme,
    page: ThemePage,
    content: string,
    css: string,
    viewport: string,
    cspNonce?: string
  ): string {
    const viewportWidth = viewport === 'mobile' ? 375 : viewport === 'tablet' ? 768 : 1200;
    const nonceAttr = cspNonce ? ` nonce="${cspNonce}"` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(page.name)} - ${this.escapeHtml(theme.name)}</title>
  <style${nonceAttr}>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    ${css}
  </style>
</head>
<body>
  <div class="theme-preview" data-viewport="${viewport}" style="max-width: ${viewportWidth}px; margin: 0 auto;">
    ${content}
  </div>
</body>
</html>`;
  }

  /**
   * Lighten a hex color
   */
  private lightenColor(hex: string, amount: number): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;

    const r = Math.round(rgb.r + (255 - rgb.r) * amount);
    const g = Math.round(rgb.g + (255 - rgb.g) * amount);
    const b = Math.round(rgb.b + (255 - rgb.b) * amount);

    return this.rgbToHex(r, g, b);
  }

  /**
   * Darken a hex color
   */
  private darkenColor(hex: string, amount: number): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;

    const r = Math.round(rgb.r * (1 - amount));
    const g = Math.round(rgb.g * (1 - amount));
    const b = Math.round(rgb.b * (1 - amount));

    return this.rgbToHex(r, g, b);
  }

  /**
   * Convert hex to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1] ?? '0', 16),
          g: parseInt(result[2] ?? '0', 16),
          b: parseInt(result[3] ?? '0', 16),
        }
      : null;
  }

  /**
   * Convert RGB to hex
   */
  private rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }

  /**
   * Get border radius CSS value
   */
  private getBorderRadius(radius?: 'none' | 'sm' | 'md' | 'lg'): string {
    const values: Record<string, string> = {
      none: '0',
      sm: '0.25rem',
      md: '0.5rem',
      lg: '1rem',
    };
    return values[radius ?? 'md'] ?? '0.5rem';
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

/**
 * Singleton preview service instance
 */
export const previewService = new ThemePreviewService();

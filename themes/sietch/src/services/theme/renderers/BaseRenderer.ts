/**
 * Base Component Renderer
 *
 * Foundation for all component renderers with common utilities.
 * Sprint 6: Component System - Preview Engine
 *
 * @see grimoires/loa/sdd.md §7.1 Component Registry Architecture
 */

import type { ComponentInstance, ComponentProps } from '../../../types/theme-component.types.js';

// =============================================================================
// Render Context Types
// =============================================================================

/**
 * RenderContext - Context provided to renderers
 */
export interface RenderContext {
  /** Theme configuration */
  theme: {
    id: string;
    name: string;
    branding: ThemeBranding;
  };

  /** Current page being rendered */
  page: {
    id: string;
    name: string;
    slug: string;
  };

  /** User context for gating */
  user?: {
    wallet?: string;
    roles?: string[];
    balances?: Record<string, string>;
    nftHoldings?: Record<string, string[]>;
  };

  /** Whether to use mock data */
  mockMode: boolean;

  /** Viewport for responsive rendering */
  viewport: 'desktop' | 'tablet' | 'mobile';
}

/**
 * Theme branding configuration
 */
export interface ThemeBranding {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: 'none' | 'sm' | 'md' | 'lg';
}

// =============================================================================
// Base Renderer Interface
// =============================================================================

/**
 * ComponentRenderer - Interface for component renderers
 */
export interface ComponentRenderer<T extends ComponentProps = ComponentProps> {
  /** Render component to HTML */
  render(props: T, context: RenderContext): string;

  /** Get CSS styles for component */
  getStyles(props: T): string;

  /** Get component type */
  getType(): string;
}

// =============================================================================
// HTML Utilities
// =============================================================================

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] ?? char);
}

/**
 * Whitelist of safe URL protocols for links
 * SECURITY: Prevents javascript:, data:, vbscript: XSS attacks
 */
const SAFE_URL_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * Validate URL and check for safe protocol
 * SECURITY: Part of CRIT-1 XSS remediation
 *
 * @param url - URL to validate
 * @returns true if URL is safe to use in href
 */
export function isSafeUrl(url: string): boolean {
  // Empty URLs are not safe
  if (!url || url.trim() === '') {
    return false;
  }

  try {
    // Parse URL (relative URLs get resolved against a safe base)
    const parsedUrl = new URL(url, 'https://placeholder.com');

    // Check protocol whitelist
    if (!SAFE_URL_PROTOCOLS.includes(parsedUrl.protocol.toLowerCase())) {
      return false;
    }

    // Block URLs with embedded dangerous content
    const lowerUrl = url.toLowerCase();
    if (
      lowerUrl.includes('base64') ||
      lowerUrl.includes('<script') ||
      lowerUrl.includes('javascript:') ||
      lowerUrl.includes('vbscript:') ||
      lowerUrl.includes('data:')
    ) {
      return false;
    }

    return true;
  } catch {
    // Invalid URL - not safe
    return false;
  }
}

/**
 * Convert markdown to HTML (basic subset)
 * SECURITY: URLs are validated to prevent XSS via dangerous protocols
 *
 * @see CRIT-1 in Security Audit Report (2026-01-21)
 */
export function markdownToHtml(markdown: string): string {
  let html = escapeHtml(markdown);

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Code: `code`
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Links: [text](url) - SECURE VERSION with URL validation
  // SECURITY: Only allows http(s) and mailto protocols
  // Note: At this point, the URL is already HTML-escaped (& -> &amp;)
  // We need to unescape for validation, then the URL is already safe in the output
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, (_match, text: string, escapedUrl: string) => {
    // Unescape URL for validation (reverse the escapeHtml we did earlier)
    const url = escapedUrl
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

    // Validate URL is safe
    if (!isSafeUrl(url)) {
      // Return text only, strip dangerous link
      return text;
    }

    // Safe to render link - use the already-escaped URL from input
    return `<a href="${escapedUrl}" rel="noopener noreferrer" target="_blank">${text}</a>`;
  });

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph
  html = `<p>${html}</p>`;

  return html;
}

/**
 * Generate CSS class name with component prefix
 */
export function componentClass(componentType: string, ...modifiers: string[]): string {
  const base = `theme-${componentType}`;
  if (modifiers.length === 0) return base;
  return [base, ...modifiers.map((m) => `${base}--${m}`)].join(' ');
}

/**
 * Convert size token to CSS value
 */
export function sizeToPixels(size: 'none' | 'sm' | 'md' | 'lg' | 'xl'): string {
  const sizes: Record<string, string> = {
    none: '0',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  };
  return sizes[size] ?? '1rem';
}

/**
 * Generate CSS variable reference
 */
export function cssVar(name: string, fallback?: string): string {
  return fallback ? `var(--theme-${name}, ${fallback})` : `var(--theme-${name})`;
}

// =============================================================================
// Mock Data Generators
// =============================================================================

/**
 * Generate mock wallet address
 */
export function mockWalletAddress(): string {
  return '0x1234...5678';
}

/**
 * Generate mock token balance
 */
export function mockTokenBalance(): string {
  return '1,000.00';
}

/**
 * Generate mock NFT data
 */
export function mockNftData(count: number = 8): Array<{ id: string; image: string; name: string }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `${i + 1}`,
    image: `https://picsum.photos/seed/${i + 1}/300/300`,
    name: `NFT #${i + 1}`,
  }));
}

/**
 * Generate mock leaderboard data
 */
export function mockLeaderboardData(
  count: number = 10
): Array<{ rank: number; name: string; avatar: string; value: string }> {
  const names = [
    'CryptoKing',
    'DiamondHands',
    'MoonWalker',
    'TokenMaster',
    'NFTCollector',
    'DeFiPro',
    'ChainGamer',
    'MetaTrader',
    'BlockBuilder',
    'CoinHunter',
  ];
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    name: names[i % names.length] ?? `User${i + 1}`,
    avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${i}`,
    value: `${Math.floor(Math.random() * 10000).toLocaleString()}`,
  }));
}

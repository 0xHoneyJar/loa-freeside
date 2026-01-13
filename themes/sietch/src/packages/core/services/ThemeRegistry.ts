/**
 * ThemeRegistry - Theme Registration and Access Control
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Provides:
 * - Theme registration and lookup
 * - Subscription tier validation for theme access
 * - Available themes filtering based on subscription
 *
 * @module packages/core/services/ThemeRegistry
 */

import type { IThemeProvider, SubscriptionTier } from '../ports/IThemeProvider.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Theme access validation result
 */
export interface ThemeAccessResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
  /** Required subscription tier */
  requiredTier?: SubscriptionTier;
}

/**
 * Subscription tier hierarchy (higher index = more access)
 */
const SUBSCRIPTION_TIER_ORDER: SubscriptionTier[] = ['free', 'premium', 'enterprise'];

// =============================================================================
// ThemeRegistry Implementation
// =============================================================================

/**
 * ThemeRegistry
 *
 * Central registry for theme providers.
 * Manages theme registration, lookup, and subscription-based access control.
 */
export class ThemeRegistry {
  private readonly themes: Map<string, IThemeProvider> = new Map();

  /**
   * Register a theme provider
   *
   * @param theme - Theme provider to register
   * @throws Error if theme with same ID already registered
   */
  register(theme: IThemeProvider): void {
    if (this.themes.has(theme.themeId)) {
      throw new Error(`Theme '${theme.themeId}' is already registered`);
    }
    this.themes.set(theme.themeId, theme);
  }

  /**
   * Register multiple themes at once
   *
   * @param themes - Array of theme providers
   */
  registerAll(themes: IThemeProvider[]): void {
    for (const theme of themes) {
      this.register(theme);
    }
  }

  /**
   * Unregister a theme
   *
   * @param themeId - Theme ID to unregister
   * @returns true if theme was removed
   */
  unregister(themeId: string): boolean {
    return this.themes.delete(themeId);
  }

  /**
   * Get a theme by ID
   *
   * @param themeId - Theme ID
   * @returns Theme provider or undefined
   */
  get(themeId: string): IThemeProvider | undefined {
    return this.themes.get(themeId);
  }

  /**
   * Get a theme by ID, throwing if not found
   *
   * @param themeId - Theme ID
   * @returns Theme provider
   * @throws Error if theme not found
   */
  getOrThrow(themeId: string): IThemeProvider {
    const theme = this.themes.get(themeId);
    if (!theme) {
      throw new Error(`Theme '${themeId}' not found`);
    }
    return theme;
  }

  /**
   * Check if a theme exists
   *
   * @param themeId - Theme ID
   * @returns true if theme is registered
   */
  has(themeId: string): boolean {
    return this.themes.has(themeId);
  }

  /**
   * Get all registered theme IDs
   */
  getThemeIds(): string[] {
    return Array.from(this.themes.keys());
  }

  /**
   * Get all registered themes
   */
  getAllThemes(): IThemeProvider[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get themes available for a subscription tier
   *
   * @param subscriptionTier - User's subscription tier
   * @returns Array of accessible themes
   */
  getAvailableThemes(subscriptionTier: SubscriptionTier): IThemeProvider[] {
    return Array.from(this.themes.values()).filter(
      (theme) => this.canAccessTier(subscriptionTier, theme.tier)
    );
  }

  /**
   * Validate if a subscription tier can access a theme
   *
   * @param themeId - Theme ID to validate
   * @param subscriptionTier - User's subscription tier
   * @returns Access validation result
   */
  validateAccess(themeId: string, subscriptionTier: SubscriptionTier): ThemeAccessResult {
    const theme = this.themes.get(themeId);

    if (!theme) {
      return {
        allowed: false,
        reason: `Theme '${themeId}' not found`,
      };
    }

    if (!this.canAccessTier(subscriptionTier, theme.tier)) {
      return {
        allowed: false,
        reason: `Theme '${theme.themeName}' requires ${theme.tier} subscription or higher`,
        requiredTier: theme.tier,
      };
    }

    return { allowed: true };
  }

  /**
   * Get theme with access validation
   *
   * @param themeId - Theme ID
   * @param subscriptionTier - User's subscription tier
   * @returns Theme provider
   * @throws Error if theme not found or access denied
   */
  getWithValidation(themeId: string, subscriptionTier: SubscriptionTier): IThemeProvider {
    const validation = this.validateAccess(themeId, subscriptionTier);

    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

    return this.themes.get(themeId)!;
  }

  /**
   * Check if a subscription tier can access a theme tier
   *
   * @param userTier - User's subscription tier
   * @param themeTier - Theme's required tier
   * @returns true if access is allowed
   */
  private canAccessTier(userTier: SubscriptionTier, themeTier: SubscriptionTier): boolean {
    const userIndex = SUBSCRIPTION_TIER_ORDER.indexOf(userTier);
    const themeIndex = SUBSCRIPTION_TIER_ORDER.indexOf(themeTier);
    return userIndex >= themeIndex;
  }

  /**
   * Get subscription tier comparison
   *
   * @param tier1 - First tier
   * @param tier2 - Second tier
   * @returns -1 if tier1 < tier2, 0 if equal, 1 if tier1 > tier2
   */
  compareTiers(tier1: SubscriptionTier, tier2: SubscriptionTier): number {
    const index1 = SUBSCRIPTION_TIER_ORDER.indexOf(tier1);
    const index2 = SUBSCRIPTION_TIER_ORDER.indexOf(tier2);
    return Math.sign(index1 - index2);
  }

  /**
   * Clear all registered themes
   */
  clear(): void {
    this.themes.clear();
  }

  /**
   * Get registry size
   */
  get size(): number {
    return this.themes.size;
  }
}

/**
 * Factory function to create ThemeRegistry instance
 */
export function createThemeRegistry(): ThemeRegistry {
  return new ThemeRegistry();
}

/**
 * Singleton instance for convenience
 */
export const themeRegistry = new ThemeRegistry();

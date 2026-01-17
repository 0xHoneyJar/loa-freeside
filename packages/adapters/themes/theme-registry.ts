/**
 * Theme Registry
 * Sprint S-18: SietchTheme & Theme Registry
 *
 * Centralized theme registration, lookup, and management.
 * Handles subscription tier filtering and custom theme loading.
 *
 * Features:
 * - Theme registration and lookup by ID
 * - Subscription tier filtering (free/pro/enterprise)
 * - Custom theme loading with validation
 * - Hot-reload support for configuration changes
 *
 * @see SDD §6.2.5 Theme Registry
 */

import type {
  IThemeProvider,
  SubscriptionTier,
  ThemeValidationResult,
} from '../../core/ports/theme-provider.js';
import { validateTheme } from '../../core/ports/theme-provider.js';
import { basicTheme } from './basic-theme.js';
import { sietchTheme } from './sietch-theme.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Theme metadata for registry listing
 */
export interface ThemeMetadata {
  /** Theme ID */
  id: string;
  /** Theme name */
  name: string;
  /** Theme description */
  description: string;
  /** Required subscription tier */
  subscriptionTier: SubscriptionTier;
}

/**
 * Custom theme configuration for enterprise themes
 */
export interface CustomThemeConfig {
  /** Theme ID (must be unique) */
  id: string;
  /** Theme name */
  name: string;
  /** Theme description */
  description: string;
  /** Theme provider instance */
  provider: IThemeProvider;
}

/**
 * Registry configuration options
 */
export interface ThemeRegistryOptions {
  /** Enable hot-reload watching (default: true) */
  enableHotReload?: boolean;
  /** Hot-reload interval in ms (default: 30000) */
  hotReloadInterval?: number;
}

/**
 * Subscription tier hierarchy for filtering
 * Higher index = more access
 */
const TIER_HIERARCHY: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

// --------------------------------------------------------------------------
// Theme Registry Implementation
// --------------------------------------------------------------------------

/**
 * Theme Registry
 *
 * Centralized registry for theme management.
 * Handles registration, lookup, filtering by subscription, and hot-reload.
 *
 * @example
 * const registry = new ThemeRegistry();
 *
 * // Get theme by ID
 * const theme = registry.get('sietch');
 *
 * // Get available themes for subscription
 * const themes = registry.getAvailableThemes('pro');
 *
 * // Register custom enterprise theme
 * registry.registerTheme(myCustomTheme);
 */
export class ThemeRegistry {
  private themes: Map<string, IThemeProvider> = new Map();
  private hotReloadEnabled: boolean;
  private hotReloadInterval: number;
  private hotReloadTimer: ReturnType<typeof setInterval> | null = null;
  private reloadCallbacks: Array<() => void> = [];
  private lastReloadTime: number = Date.now();

  constructor(options: ThemeRegistryOptions = {}) {
    this.hotReloadEnabled = options.enableHotReload ?? true;
    this.hotReloadInterval = options.hotReloadInterval ?? 30000;

    // Register built-in themes
    this.registerBuiltInThemes();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Get a theme by ID
   *
   * @param id - Theme ID
   * @returns Theme provider or undefined if not found
   */
  get(id: string): IThemeProvider | undefined {
    return this.themes.get(id);
  }

  /**
   * Get all registered themes
   *
   * @returns Array of all theme providers
   */
  getAll(): IThemeProvider[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get themes available for a subscription tier
   *
   * Filters themes based on subscription hierarchy:
   * - free: Only free themes (BasicTheme)
   * - pro: Free + pro themes (BasicTheme, SietchTheme)
   * - enterprise: All themes (including custom)
   *
   * @param subscriptionTier - User's subscription tier
   * @returns Array of available theme providers
   */
  getAvailableThemes(subscriptionTier: SubscriptionTier): IThemeProvider[] {
    const userTierIndex = TIER_HIERARCHY.indexOf(subscriptionTier);

    return Array.from(this.themes.values()).filter((theme) => {
      const themeTierIndex = TIER_HIERARCHY.indexOf(theme.subscriptionTier);
      return themeTierIndex <= userTierIndex;
    });
  }

  /**
   * Get metadata for available themes (without loading full providers)
   *
   * @param subscriptionTier - User's subscription tier
   * @returns Array of theme metadata
   */
  getAvailableThemeMetadata(subscriptionTier: SubscriptionTier): ThemeMetadata[] {
    return this.getAvailableThemes(subscriptionTier).map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      subscriptionTier: theme.subscriptionTier,
    }));
  }

  /**
   * Check if a theme is available for a subscription tier
   *
   * @param themeId - Theme ID to check
   * @param subscriptionTier - User's subscription tier
   * @returns true if theme is available
   */
  isThemeAvailable(themeId: string, subscriptionTier: SubscriptionTier): boolean {
    const theme = this.themes.get(themeId);
    if (!theme) return false;

    const userTierIndex = TIER_HIERARCHY.indexOf(subscriptionTier);
    const themeTierIndex = TIER_HIERARCHY.indexOf(theme.subscriptionTier);
    return themeTierIndex <= userTierIndex;
  }

  /**
   * Register a theme
   *
   * @param theme - Theme provider to register
   * @throws Error if theme ID already exists or validation fails
   */
  registerTheme(theme: IThemeProvider): void {
    // Check for duplicate ID
    if (this.themes.has(theme.id)) {
      throw new Error(`Theme with ID '${theme.id}' is already registered`);
    }

    // Validate theme
    const validation = validateTheme(theme);
    if (!validation.valid) {
      throw new Error(
        `Theme validation failed: ${validation.errors.join(', ')}`
      );
    }

    this.themes.set(theme.id, theme);
  }

  /**
   * Unregister a theme by ID
   *
   * @param id - Theme ID to unregister
   * @returns true if theme was removed, false if not found
   */
  unregisterTheme(id: string): boolean {
    // Prevent unregistering built-in themes
    if (id === 'basic' || id === 'sietch') {
      throw new Error(`Cannot unregister built-in theme '${id}'`);
    }
    return this.themes.delete(id);
  }

  /**
   * Load a custom theme (Enterprise feature)
   *
   * Validates and registers a custom theme configuration.
   *
   * @param config - Custom theme configuration
   * @returns Validation result with success/error info
   */
  loadCustomTheme(config: CustomThemeConfig): ThemeValidationResult {
    // Validate required fields
    if (!config.id || !config.name || !config.provider) {
      return {
        valid: false,
        errors: ['Custom theme config must include id, name, and provider'],
      };
    }

    // Check for duplicate ID
    if (this.themes.has(config.id)) {
      return {
        valid: false,
        errors: [`Theme with ID '${config.id}' is already registered`],
      };
    }

    // Validate theme structure
    const validation = validateTheme(config.provider);
    if (!validation.valid) {
      return validation;
    }

    // Register the theme
    this.themes.set(config.id, config.provider);

    return { valid: true, errors: [] };
  }

  // --------------------------------------------------------------------------
  // Hot-Reload Support
  // --------------------------------------------------------------------------

  /**
   * Start hot-reload watching
   *
   * Periodically checks for configuration changes and triggers reload callbacks.
   */
  startHotReload(): void {
    if (!this.hotReloadEnabled || this.hotReloadTimer) {
      return;
    }

    this.hotReloadTimer = setInterval(() => {
      this.checkForReload();
    }, this.hotReloadInterval);
  }

  /**
   * Stop hot-reload watching
   */
  stopHotReload(): void {
    if (this.hotReloadTimer) {
      clearInterval(this.hotReloadTimer);
      this.hotReloadTimer = null;
    }
  }

  /**
   * Register a callback for hot-reload events
   *
   * @param callback - Function to call on reload
   * @returns Unsubscribe function
   */
  onReload(callback: () => void): () => void {
    this.reloadCallbacks.push(callback);
    return () => {
      const index = this.reloadCallbacks.indexOf(callback);
      if (index !== -1) {
        this.reloadCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Manually trigger a reload
   *
   * Notifies all registered callbacks that themes may have changed.
   */
  triggerReload(): void {
    this.lastReloadTime = Date.now();
    for (const callback of this.reloadCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Get time since last reload in milliseconds
   */
  getTimeSinceLastReload(): number {
    return Date.now() - this.lastReloadTime;
  }

  /**
   * Check if hot-reload is enabled
   */
  isHotReloadEnabled(): boolean {
    return this.hotReloadEnabled;
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get the number of registered themes
   */
  get size(): number {
    return this.themes.size;
  }

  /**
   * Check if a theme ID exists
   *
   * @param id - Theme ID to check
   */
  has(id: string): boolean {
    return this.themes.has(id);
  }

  /**
   * Get all theme IDs
   */
  getThemeIds(): string[] {
    return Array.from(this.themes.keys());
  }

  /**
   * Clear all registered themes (except built-ins)
   *
   * Useful for testing or resetting custom themes.
   */
  clearCustomThemes(): void {
    const builtInIds = ['basic', 'sietch'];
    for (const id of this.themes.keys()) {
      if (!builtInIds.includes(id)) {
        this.themes.delete(id);
      }
    }
  }

  /**
   * Dispose of the registry
   *
   * Stops hot-reload and clears callbacks.
   */
  dispose(): void {
    this.stopHotReload();
    this.reloadCallbacks = [];
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Register built-in themes
   */
  private registerBuiltInThemes(): void {
    this.themes.set(basicTheme.id, basicTheme);
    this.themes.set(sietchTheme.id, sietchTheme);
  }

  /**
   * Check for reload conditions
   */
  private checkForReload(): void {
    // In a real implementation, this would check for:
    // - Config file changes
    // - Database updates
    // - External signals
    // For now, it's a no-op that can be extended
  }
}

// --------------------------------------------------------------------------
// Singleton Export
// --------------------------------------------------------------------------

/**
 * Default ThemeRegistry instance
 * Use this for most cases to share theme state across the application
 */
export const themeRegistry = new ThemeRegistry();

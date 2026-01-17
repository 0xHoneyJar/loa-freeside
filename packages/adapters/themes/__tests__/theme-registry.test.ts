/**
 * Theme Registry Tests
 * Sprint S-18: SietchTheme & Theme Registry
 *
 * Tests for ThemeRegistry including subscription filtering and hot-reload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeRegistry, themeRegistry } from '../theme-registry.js';
import { basicTheme } from '../basic-theme.js';
import { sietchTheme } from '../sietch-theme.js';
import type {
  IThemeProvider,
  TierConfig,
  BadgeConfig,
  NamingConfig,
  TierResult,
  EarnedBadge,
  Profile,
  ProfileHistory,
  SubscriptionTier,
} from '../../../core/ports/theme-provider.js';

// --------------------------------------------------------------------------
// Mock Theme for Testing
// --------------------------------------------------------------------------

class MockTheme implements IThemeProvider {
  constructor(
    public readonly id: string = 'mock',
    public readonly name: string = 'Mock Theme',
    public readonly description: string = 'A mock theme for testing',
    public readonly subscriptionTier: SubscriptionTier = 'enterprise'
  ) {}

  getTierConfig(): TierConfig[] {
    return [
      {
        id: 'high',
        name: 'High',
        displayName: 'High',
        minRank: 1,
        maxRank: 10,
        roleColor: 0xffffff,
        permissions: [],
      },
      {
        id: 'low',
        name: 'Low',
        displayName: 'Low',
        minRank: 11,
        maxRank: 100,
        roleColor: 0x808080,
        permissions: [],
      },
    ];
  }

  getBadgeConfig(): BadgeConfig[] {
    return [
      {
        id: 'mock_badge',
        name: 'Mock Badge',
        displayName: 'Mock Badge',
        description: 'A mock badge',
        emoji: '🏆',
        evaluator: 'manual_grant',
        parameters: {},
        rarity: 'common',
      },
    ];
  }

  getNamingConfig(): NamingConfig {
    return {
      tierPrefix: 'Mock',
      tierSuffix: '',
      communityNoun: 'Members',
      leaderboardTitle: 'Mock Leaderboard',
      scoreLabel: 'Points',
    };
  }

  evaluateTier(score: number, totalMembers: number, rank: number): TierResult {
    const tiers = this.getTierConfig();
    const tier = tiers.find((t) => rank >= t.minRank && rank <= t.maxRank) ?? tiers[1];
    return {
      tier,
      score,
      rank,
      percentile: Math.round((1 - (rank - 1) / totalMembers) * 100),
    };
  }

  evaluateBadges(_profile: Profile, _history: ProfileHistory): EarnedBadge[] {
    return [];
  }
}

// --------------------------------------------------------------------------
// Theme Registry Tests
// --------------------------------------------------------------------------

describe('ThemeRegistry', () => {
  let registry: ThemeRegistry;

  beforeEach(() => {
    registry = new ThemeRegistry({ enableHotReload: false });
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('Initialization', () => {
    it('should register built-in themes on creation', () => {
      expect(registry.has('basic')).toBe(true);
      expect(registry.has('sietch')).toBe(true);
    });

    it('should have 2 built-in themes', () => {
      expect(registry.size).toBe(2);
    });

    it('should return correct basic theme', () => {
      const theme = registry.get('basic');
      expect(theme).toBe(basicTheme);
    });

    it('should return correct sietch theme', () => {
      const theme = registry.get('sietch');
      expect(theme).toBe(sietchTheme);
    });
  });

  describe('get()', () => {
    it('should return theme by ID', () => {
      const theme = registry.get('basic');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('basic');
    });

    it('should return undefined for unknown ID', () => {
      const theme = registry.get('unknown');
      expect(theme).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('should return all registered themes', () => {
      const themes = registry.getAll();
      expect(themes).toHaveLength(2);
      expect(themes.map((t) => t.id)).toContain('basic');
      expect(themes.map((t) => t.id)).toContain('sietch');
    });
  });

  describe('getAvailableThemes() - Subscription Filtering', () => {
    it('should return only free themes for free tier', () => {
      const themes = registry.getAvailableThemes('free');
      expect(themes).toHaveLength(1);
      expect(themes[0].id).toBe('basic');
    });

    it('should return free and pro themes for pro tier', () => {
      const themes = registry.getAvailableThemes('pro');
      expect(themes).toHaveLength(2);
      expect(themes.map((t) => t.id)).toContain('basic');
      expect(themes.map((t) => t.id)).toContain('sietch');
    });

    it('should return all themes for enterprise tier', () => {
      const themes = registry.getAvailableThemes('enterprise');
      expect(themes).toHaveLength(2);
    });

    it('should include enterprise themes for enterprise tier', () => {
      const mockTheme = new MockTheme('enterprise-theme', 'Enterprise Theme', 'Enterprise', 'enterprise');
      registry.registerTheme(mockTheme);

      const freeThemes = registry.getAvailableThemes('free');
      const proThemes = registry.getAvailableThemes('pro');
      const enterpriseThemes = registry.getAvailableThemes('enterprise');

      expect(freeThemes.map((t) => t.id)).not.toContain('enterprise-theme');
      expect(proThemes.map((t) => t.id)).not.toContain('enterprise-theme');
      expect(enterpriseThemes.map((t) => t.id)).toContain('enterprise-theme');
    });
  });

  describe('getAvailableThemeMetadata()', () => {
    it('should return metadata for available themes', () => {
      const metadata = registry.getAvailableThemeMetadata('pro');
      expect(metadata).toHaveLength(2);

      const basicMeta = metadata.find((m) => m.id === 'basic');
      expect(basicMeta).toBeDefined();
      expect(basicMeta?.name).toBe('Basic Theme');
      expect(basicMeta?.subscriptionTier).toBe('free');

      const sietchMeta = metadata.find((m) => m.id === 'sietch');
      expect(sietchMeta).toBeDefined();
      expect(sietchMeta?.name).toBe('Sietch Theme');
      expect(sietchMeta?.subscriptionTier).toBe('pro');
    });
  });

  describe('isThemeAvailable()', () => {
    it('should return true for basic theme with free tier', () => {
      expect(registry.isThemeAvailable('basic', 'free')).toBe(true);
    });

    it('should return false for sietch theme with free tier', () => {
      expect(registry.isThemeAvailable('sietch', 'free')).toBe(false);
    });

    it('should return true for sietch theme with pro tier', () => {
      expect(registry.isThemeAvailable('sietch', 'pro')).toBe(true);
    });

    it('should return false for unknown theme', () => {
      expect(registry.isThemeAvailable('unknown', 'enterprise')).toBe(false);
    });
  });

  describe('registerTheme()', () => {
    it('should register a new theme', () => {
      const mockTheme = new MockTheme('custom');
      registry.registerTheme(mockTheme);

      expect(registry.has('custom')).toBe(true);
      expect(registry.get('custom')).toBe(mockTheme);
    });

    it('should throw on duplicate ID', () => {
      const mockTheme = new MockTheme('basic'); // Same ID as built-in

      expect(() => registry.registerTheme(mockTheme)).toThrow(
        "Theme with ID 'basic' is already registered"
      );
    });

    it('should throw on invalid theme', () => {
      // Create a theme with only 1 tier (invalid)
      class InvalidTheme extends MockTheme {
        constructor() {
          super('invalid');
        }
        override getTierConfig(): TierConfig[] {
          return [
            {
              id: 'only',
              name: 'Only',
              displayName: 'Only',
              minRank: 1,
              maxRank: 100,
              roleColor: 0xffffff,
              permissions: [],
            },
          ];
        }
      }

      expect(() => registry.registerTheme(new InvalidTheme())).toThrow(
        'Theme validation failed'
      );
    });
  });

  describe('unregisterTheme()', () => {
    it('should unregister a custom theme', () => {
      const mockTheme = new MockTheme('custom');
      registry.registerTheme(mockTheme);
      expect(registry.has('custom')).toBe(true);

      const removed = registry.unregisterTheme('custom');
      expect(removed).toBe(true);
      expect(registry.has('custom')).toBe(false);
    });

    it('should return false for unknown theme', () => {
      const removed = registry.unregisterTheme('unknown');
      expect(removed).toBe(false);
    });

    it('should throw when unregistering built-in theme', () => {
      expect(() => registry.unregisterTheme('basic')).toThrow(
        "Cannot unregister built-in theme 'basic'"
      );
      expect(() => registry.unregisterTheme('sietch')).toThrow(
        "Cannot unregister built-in theme 'sietch'"
      );
    });
  });

  describe('loadCustomTheme()', () => {
    it('should load a valid custom theme', () => {
      const config = {
        id: 'custom',
        name: 'Custom Theme',
        description: 'A custom theme',
        provider: new MockTheme('custom'),
      };

      const result = registry.loadCustomTheme(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(registry.has('custom')).toBe(true);
    });

    it('should reject missing ID', () => {
      const config = {
        id: '',
        name: 'Custom Theme',
        description: 'A custom theme',
        provider: new MockTheme(''),
      };

      const result = registry.loadCustomTheme(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must include id');
    });

    it('should reject duplicate ID', () => {
      const config = {
        id: 'basic',
        name: 'Another Basic',
        description: 'Conflict',
        provider: new MockTheme('basic'),
      };

      const result = registry.loadCustomTheme(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('already registered');
    });

    it('should reject invalid theme structure', () => {
      class InvalidProvider extends MockTheme {
        constructor() {
          super('invalid');
        }
        override getTierConfig(): TierConfig[] {
          return [
            {
              id: 'only',
              name: 'Only',
              displayName: 'Only',
              minRank: 1,
              maxRank: 100,
              roleColor: 0xffffff,
              permissions: [],
            },
          ];
        }
      }

      const config = {
        id: 'invalid',
        name: 'Invalid Theme',
        description: 'Invalid',
        provider: new InvalidProvider(),
      };

      const result = registry.loadCustomTheme(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least 2 tiers');
    });
  });

  describe('Hot-Reload', () => {
    it('should not start hot-reload by default with enableHotReload: false', () => {
      const reg = new ThemeRegistry({ enableHotReload: false });
      expect(reg.isHotReloadEnabled()).toBe(false);
      reg.dispose();
    });

    it('should enable hot-reload by default', () => {
      const reg = new ThemeRegistry();
      expect(reg.isHotReloadEnabled()).toBe(true);
      reg.dispose();
    });

    it('should allow custom hot-reload interval', () => {
      const reg = new ThemeRegistry({ hotReloadInterval: 5000 });
      expect(reg.isHotReloadEnabled()).toBe(true);
      reg.dispose();
    });

    it('should trigger reload callbacks', () => {
      const callback = vi.fn();
      registry.onReload(callback);
      registry.triggerReload();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from reload callbacks', () => {
      const callback = vi.fn();
      const unsubscribe = registry.onReload(callback);

      unsubscribe();
      registry.triggerReload();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should track time since last reload', () => {
      const before = registry.getTimeSinceLastReload();
      registry.triggerReload();
      const after = registry.getTimeSinceLastReload();

      expect(after).toBeLessThanOrEqual(before);
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = () => {
        throw new Error('Callback error');
      };
      const successCallback = vi.fn();

      registry.onReload(errorCallback);
      registry.onReload(successCallback);

      // Should not throw
      expect(() => registry.triggerReload()).not.toThrow();

      // Second callback should still be called
      expect(successCallback).toHaveBeenCalled();
    });
  });

  describe('Utility Methods', () => {
    it('should return theme IDs', () => {
      const ids = registry.getThemeIds();
      expect(ids).toContain('basic');
      expect(ids).toContain('sietch');
    });

    it('should clear custom themes', () => {
      registry.registerTheme(new MockTheme('custom1'));
      registry.registerTheme(new MockTheme('custom2'));
      expect(registry.size).toBe(4);

      registry.clearCustomThemes();
      expect(registry.size).toBe(2);
      expect(registry.has('basic')).toBe(true);
      expect(registry.has('sietch')).toBe(true);
      expect(registry.has('custom1')).toBe(false);
      expect(registry.has('custom2')).toBe(false);
    });

    it('should dispose properly', () => {
      const callback = vi.fn();
      registry.onReload(callback);
      registry.dispose();

      // Callbacks should be cleared
      registry.triggerReload();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Singleton Export', () => {
    it('should export singleton instance', () => {
      expect(themeRegistry).toBeInstanceOf(ThemeRegistry);
    });

    it('should have built-in themes registered', () => {
      expect(themeRegistry.has('basic')).toBe(true);
      expect(themeRegistry.has('sietch')).toBe(true);
    });
  });
});
